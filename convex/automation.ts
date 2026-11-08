import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { daysBetween } from "./lib/dates";
import { buildSignedMessage, hmacSha256Hex } from "./lib/hmac";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s, 60s, 2m, 4m, ...
const REQUEST_TIMEOUT_MS = 10_000;

const eventValidator = v.union(
  v.literal("created"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
);

/**
 * Minimal context for a notification. Data minimization: n8n only receives the
 * recipient's name + email, the tool name and the dates. No ids of other
 * people, no description, no role, no addresses.
 */
export const getEventContext = internalQuery({
  args: { loanId: v.id("loans"), event: eventValidator },
  handler: async (ctx, { loanId, event }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const [tool, borrower, lender] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.borrowerId),
      ctx.db.get(loan.lenderId),
    ]);
    // A new request notifies the lender; every status change notifies the borrower.
    const recipient = event === "created" ? lender : borrower;
    if (!tool || !recipient) return null;
    return {
      event,
      loan: {
        id: loan._id,
        toolName: tool.name,
        startDate: loan.startDate,
        endDate: loan.endDate,
      },
      recipient: { name: recipient.name, email: recipient.email ?? null },
    };
  },
});

/** Idempotent: the same key always resolves to the same record. */
export const claimEvent = internalMutation({
  args: {
    loanId: v.id("loans"),
    kind: v.union(v.literal("notification"), v.literal("reminder")),
    key: v.string(),
  },
  handler: async (ctx, { loanId, kind, key }) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
      .unique();
    if (existing) return { eventId: existing._id, status: existing.status };
    const eventId = await ctx.db.insert("automationEvents", {
      loanId,
      kind,
      idempotencyKey: key,
      status: "pending",
      attempts: 0,
      updatedAt: Date.now(),
    });
    return { eventId, status: "pending" as const };
  },
});

export const finishEvent = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, status, attempts, detail }) => {
    await ctx.db.patch(eventId, {
      status,
      attempts,
      detail: detail?.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Convex -> n8n. Signs the body with HMAC-SHA256, retries with exponential
 * backoff, and records the final outcome so a failure is never silent: it is
 * visible on the loan in the app ("failed") and in the Convex logs.
 */
export const sendLoanEvent = internalAction({
  args: { loanId: v.id("loans"), event: eventValidator, attempt: v.number() },
  handler: async (ctx, { loanId, event, attempt }) => {
    const key = `loan-event:${loanId}:${event}`;
    const claimed = await ctx.runMutation(internal.automation.claimEvent, {
      loanId,
      kind: "notification",
      key,
    });
    if (claimed.status === "sent") return; // already delivered, retry is a no-op

    const finish = (
      status: "pending" | "sent" | "failed",
      detail: string,
      attempts: number,
    ) =>
      ctx.runMutation(internal.automation.finishEvent, {
        eventId: claimed.eventId,
        status,
        attempts,
        detail,
      });

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      console.error("[automation] N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET not set");
      await finish("failed", "automation not configured", attempt + 1);
      return;
    }

    const context = await ctx.runQuery(internal.automation.getEventContext, {
      loanId,
      event,
    });
    if (!context) {
      await finish("failed", "loan context not found", attempt + 1);
      return;
    }

    const body = JSON.stringify({
      eventId: key,
      occurredAt: new Date().toISOString(),
      ...context,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const pathname = new URL(url).pathname;
    const signature = await hmacSha256Hex(
      secret,
      buildSignedMessage(timestamp, "POST", pathname, body),
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-signature": signature,
          "x-lendloop-event-id": key,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`n8n responded ${response.status}`);
      await finish("sent", `delivered (attempt ${attempt + 1})`, attempt + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      if (attempt + 1 < MAX_ATTEMPTS) {
        await finish("pending", `retrying: ${message}`, attempt + 1);
        await ctx.scheduler.runAfter(
          BASE_BACKOFF_MS * 2 ** attempt,
          internal.automation.sendLoanEvent,
          { loanId, event, attempt: attempt + 1 },
        );
      } else {
        console.error(`[automation] giving up on ${key}: ${message}`);
        await finish("failed", `gave up: ${message}`, attempt + 1);
      }
    }
  },
});

/**
 * Loans that are overdue today and have NOT yet had a successful reminder
 * today. Returns only what n8n needs to send the reminder.
 */
export const overdueForReminder = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const result = [];
    for (const loan of approved) {
      if (loan.endDate >= today) continue;
      const key = `reminder:${loan._id}:${today}`;
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (existing?.status === "sent") continue;
      const [tool, borrower] = await Promise.all([
        ctx.db.get(loan.toolId),
        ctx.db.get(loan.borrowerId),
      ]);
      if (!tool || !borrower) continue;
      result.push({
        loanId: loan._id,
        toolName: tool.name,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { name: borrower.name, email: borrower.email ?? null },
      });
    }
    return result;
  },
});

/** Validates an id string coming from outside (n8n) before using it. */
export const normalizeLoanId = internalQuery({
  args: { loanId: v.string() },
  handler: async (ctx, { loanId }) => {
    const id = ctx.db.normalizeId("loans", loanId);
    if (!id) return null;
    return (await ctx.db.get(id)) ? id : null;
  },
});

/**
 * Write-back from n8n. Idempotent on `reminder:<loan>:<date>`: replaying the
 * same result never creates a second record, and a recorded "sent" is final.
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.id("loans"),
    date: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, date, status, detail }) => {
    const key = `reminder:${loanId}:${date}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
      .unique();
    if (existing) {
      if (existing.status === "sent") return { duplicate: true };
      await ctx.db.patch(existing._id, {
        status,
        attempts: existing.attempts + 1,
        detail: detail?.slice(0, 300),
        updatedAt: Date.now(),
      });
      return { duplicate: false };
    }
    await ctx.db.insert("automationEvents", {
      loanId,
      kind: "reminder",
      idempotencyKey: key,
      status,
      attempts: 1,
      detail: detail?.slice(0, 300),
      updatedAt: Date.now(),
    });
    return { duplicate: false };
  },
});
