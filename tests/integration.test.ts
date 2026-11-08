/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  buildSignedMessage,
  hmacSha256Hex,
  verifySignature,
} from "../convex/lib/hmac";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const SECRET = "test-shared-secret";

async function signed(method: string, pathname: string, body: string, ts?: number) {
  const timestamp = String(ts ?? Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(
    SECRET,
    buildSignedMessage(timestamp, method, pathname, body),
  );
  return {
    "x-lendloop-timestamp": timestamp,
    "x-lendloop-signature": signature,
  };
}

describe("HMAC helpers", () => {
  const base = { secret: SECRET, method: "POST", pathname: "/p", body: "{}" };

  it("accepts a valid signature", async () => {
    const h = await signed("POST", "/p", "{}");
    expect(
      await verifySignature({ ...base, timestamp: h["x-lendloop-timestamp"], signature: h["x-lendloop-signature"] }),
    ).toEqual({ ok: true });
  });

  it("rejects tampering, wrong path/method, stale timestamps and missing headers", async () => {
    const h = await signed("POST", "/p", "{}");
    const ts = h["x-lendloop-timestamp"];
    const sig = h["x-lendloop-signature"];
    expect((await verifySignature({ ...base, body: '{"a":1}', timestamp: ts, signature: sig })).ok).toBe(false);
    expect((await verifySignature({ ...base, pathname: "/other", timestamp: ts, signature: sig })).ok).toBe(false);
    expect((await verifySignature({ ...base, method: "GET", timestamp: ts, signature: sig })).ok).toBe(false);
    expect((await verifySignature({ ...base, secret: "nope", timestamp: ts, signature: sig })).ok).toBe(false);

    const old = await signed("POST", "/p", "{}", Math.floor(Date.now() / 1000) - 3600);
    expect(
      await verifySignature({ ...base, timestamp: old["x-lendloop-timestamp"], signature: old["x-lendloop-signature"] }),
    ).toEqual({ ok: false, reason: "stale" });
    expect(await verifySignature({ ...base, timestamp: null, signature: null })).toEqual({ ok: false, reason: "missing" });
  });
});

describe("n8n HTTP endpoints and automation", () => {
  let t: ReturnType<typeof convexTest>;
  let overdueLoan: Id<"loans">;
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(async () => {
    vi.useFakeTimers();
    process.env.N8N_WEBHOOK_SECRET = SECRET;
    process.env.N8N_WEBHOOK_URL = "https://n8n.example.test/webhook/lendloop-request-events";
    t = convexTest(schema, modules);
    overdueLoan = await t.run(async (ctx) => {
      const lender = await ctx.db.insert("users", { tokenIdentifier: "t|lender", name: "Lena", email: "lena@example.test", role: "user", trustedLender: false });
      const borrower = await ctx.db.insert("users", { tokenIdentifier: "t|borrower", name: "Ben", email: "ben@example.test", role: "user", trustedLender: false });
      const toolId = await ctx.db.insert("tools", { ownerId: lender, name: "Ladder", category: "hand tools", condition: "good", description: "secret description", onLoan: true });
      return await ctx.db.insert("loans", { toolId, borrowerId: borrower, lenderId: lender, startDate: "2020-01-01", endDate: "2020-01-05", status: "approved" });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects unsigned and badly signed requests with 401", async () => {
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);
    const h = await signed("GET", "/n8n/overdue-loans", "");
    h["x-lendloop-signature"] = "0".repeat(64);
    expect((await t.fetch("/n8n/overdue-loans", { method: "GET", headers: h })).status).toBe(401);
  });

  it("returns overdue loans with only the fields n8n needs", async () => {
    const res = await t.fetch("/n8n/overdue-loans", {
      method: "GET",
      headers: await signed("GET", "/n8n/overdue-loans", ""),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.loans).toHaveLength(1);
    expect(Object.keys(data.loans[0]).sort()).toEqual(["borrower", "daysOverdue", "endDate", "loanId", "toolName"]);
    expect(Object.keys(data.loans[0].borrower).sort()).toEqual(["email", "name"]);
    expect(JSON.stringify(data)).not.toContain("secret description");
  });

  it("makes the reminder write-back idempotent", async () => {
    const body = JSON.stringify({ loanId: overdueLoan, date: today, status: "sent", detail: "ok" });
    const post = async (b: string) =>
      t.fetch("/n8n/reminder-result", { method: "POST", headers: await signed("POST", "/n8n/reminder-result", b), body: b });

    expect(await (await post(body)).json()).toEqual({ ok: true, duplicate: false });
    expect(await (await post(body)).json()).toEqual({ ok: true, duplicate: true }); // retry
    const rows = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(rows).toHaveLength(1);

    // Sent today -> no longer returned by the overdue endpoint.
    const res = await t.fetch("/n8n/overdue-loans", { method: "GET", headers: await signed("GET", "/n8n/overdue-loans", "") });
    expect((await res.json()).loans).toHaveLength(0);
  });

  it("validates write-back payloads", async () => {
    const post = async (payload: unknown) => {
      const b = JSON.stringify(payload);
      return t.fetch("/n8n/reminder-result", { method: "POST", headers: await signed("POST", "/n8n/reminder-result", b), body: b });
    };
    expect((await post({ loanId: overdueLoan, date: "nope", status: "sent" })).status).toBe(400);
    expect((await post({ loanId: overdueLoan, date: today, status: "weird" })).status).toBe(400);
    expect((await post({ loanId: "not-an-id", date: today, status: "sent" })).status).toBe(404);
  });

  it("retries a failed webhook, then delivers once (idempotent)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const run = (attempt: number) =>
      t.action(internal.automation.sendLoanEvent, { loanId: overdueLoan, event: "created", attempt });

    await run(0);
    let [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event.status).toBe("pending"); // failure is recorded, not silent
    expect(event.detail).toContain("retrying");

    await run(1);
    [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event.status).toBe("sent");

    await run(2); // replay of an already delivered event
    expect(fetchMock).toHaveBeenCalledTimes(2); // no third delivery

    // The outgoing request is signed and minimal.
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(process.env.N8N_WEBHOOK_URL);
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(["eventId", "event", "loan", "occurredAt", "recipient"].sort());
    expect(body.recipient).toEqual({ name: "Lena", email: "lena@example.test" });
    expect(init.headers["x-lendloop-signature"]).toMatch(/^[0-9a-f]{64}$/);
    const check = await verifySignature({
      secret: SECRET,
      timestamp: init.headers["x-lendloop-timestamp"],
      signature: init.headers["x-lendloop-signature"],
      method: "POST",
      pathname: "/webhook/lendloop-request-events",
      body: init.body as string,
    });
    expect(check.ok).toBe(true);
  });

  it("marks the event failed after the last attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await t.action(internal.automation.sendLoanEvent, { loanId: overdueLoan, event: "created", attempt: 4 });
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event.status).toBe("failed");
    expect(event.detail).toContain("network down");
  });
});
