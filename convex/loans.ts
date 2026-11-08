import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";
import {
  MAX_LOAN_DAYS,
  assertValidDate,
  daysBetween,
  rangesOverlap,
  todayISO,
} from "./lib/dates";

type LoanEvent = "created" | "approved" | "declined" | "returned";

async function notify(ctx: MutationCtx, loanId: Id<"loans">, event: LoanEvent) {
  // Runs after the transaction commits; retries/backoff live in the action.
  await ctx.scheduler.runAfter(0, internal.automation.sendLoanEvent, {
    loanId,
    event,
    attempt: 0,
  });
}

async function approvedLoansForTool(
  ctx: QueryCtx | MutationCtx,
  toolId: Id<"tools">,
): Promise<Doc<"loans">[]> {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.filter((l) => l.status === "approved");
}

async function latestActivity(ctx: QueryCtx, loanId: Id<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .collect();
  if (events.length === 0) return null;
  const latest = events.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
  return {
    kind: latest.kind,
    status: latest.status,
    updatedAt: latest.updatedAt,
  };
}

async function toView(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, borrower, lender, activity] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.borrowerId),
    ctx.db.get(loan.lenderId),
    latestActivity(ctx, loan._id),
  ]);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "(removed tool)",
    borrowerName: borrower?.name ?? "Unknown",
    lenderName: lender?.name ?? "Unknown",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < todayISO(),
    activity,
  };
}

/** Any signed-in user can request a tool they do not own. */
export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    assertValidDate(startDate, "start_date");
    assertValidDate(endDate, "end_date");
    if (endDate < startDate) throw new ConvexError("INVALID_RANGE");
    if (startDate < todayISO()) throw new ConvexError("START_IN_PAST");
    if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) {
      throw new ConvexError("RANGE_TOO_LONG");
    }

    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt) throw new ConvexError("NOT_FOUND");
    if (tool.ownerId === me._id) throw new ConvexError("OWN_TOOL");

    for (const loan of await approvedLoansForTool(ctx, toolId)) {
      if (rangesOverlap(startDate, endDate, loan.startDate, loan.endDate)) {
        throw new ConvexError("DATES_UNAVAILABLE");
      }
    }

    // No duplicate pending request by the same person for the same tool.
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    if (mine.some((l) => l.toolId === toolId && l.status === "pending")) {
      throw new ConvexError("ALREADY_REQUESTED");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      borrowerId: me._id,
      lenderId: tool.ownerId,
      startDate,
      endDate,
      status: "pending",
    });
    await notify(ctx, loanId, "created");
    return loanId;
  },
});

/** Only the lender (owner of the tool) can approve or decline. */
export const respond = mutation({
  args: {
    loanId: v.id("loans"),
    decision: v.union(v.literal("approve"), v.literal("decline")),
  },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("NOT_FOUND");
    if (loan.lenderId !== me._id) throw new ConvexError("FORBIDDEN");
    if (loan.status !== "pending") throw new ConvexError("NOT_PENDING");

    if (decision === "decline") {
      await ctx.db.patch(loanId, { status: "declined" });
      await notify(ctx, loanId, "declined");
      return;
    }

    for (const other of await approvedLoansForTool(ctx, loan.toolId)) {
      if (
        rangesOverlap(loan.startDate, loan.endDate, other.startDate, other.endDate)
      ) {
        throw new ConvexError("DATES_UNAVAILABLE");
      }
    }
    await ctx.db.patch(loanId, { status: "approved" });
    await ctx.db.patch(loan.toolId, { onLoan: true });
    await notify(ctx, loanId, "approved");
  },
});

/** The lender (or an admin) marks an approved loan as returned. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("NOT_FOUND");
    if (loan.lenderId !== me._id && me.role !== "admin") {
      throw new ConvexError("FORBIDDEN");
    }
    if (loan.status !== "approved") throw new ConvexError("NOT_APPROVED");

    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    const stillApproved = (await approvedLoansForTool(ctx, loan.toolId)).filter(
      (l) => l._id !== loanId,
    );
    await ctx.db.patch(loan.toolId, { onLoan: stillApproved.length > 0 });
    await notify(ctx, loanId, "returned");
  },
});

/** "My requests": loans where I am the borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => toView(ctx, l)));
  },
});

/** "Incoming requests": loans on tools I own. */
export const incomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => toView(ctx, l)));
  },
});

/** Admin only: every loan in the system. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").collect();
    return await Promise.all(loans.map((l) => toView(ctx, l)));
  },
});
