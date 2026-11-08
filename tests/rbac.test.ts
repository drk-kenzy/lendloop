/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const ISSUER = "https://test.clerk.dev";

function setup() {
  const t = convexTest(schema, modules);
  const as = (key: string) =>
    t.withIdentity({
      subject: key,
      issuer: ISSUER,
      tokenIdentifier: `${ISSUER}|${key}`,
      name: key,
      email: `${key}@example.test`,
    });
  return { t, as };
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

// Rejections are ConvexError with a string code (see convex/lib/auth.ts).
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ data: code });
}

describe("role-based access control (enforced in Convex)", () => {
  let ctx: ReturnType<typeof setup>;
  let alice: ReturnType<ReturnType<typeof setup>["as"]>; // lender
  let bob: ReturnType<ReturnType<typeof setup>["as"]>; // borrower
  let mallory: ReturnType<ReturnType<typeof setup>["as"]>; // unrelated user
  let admin: ReturnType<ReturnType<typeof setup>["as"]>;
  let toolId: Awaited<ReturnType<typeof createTool>>;

  async function createTool() {
    return await alice.mutation(api.tools.create, {
      name: "Cordless drill",
      category: "power tools",
      condition: "good",
      description: "18V",
    });
  }

  // Fake timers keep scheduled n8n notifications from running in the background.
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    ctx = setup();
    alice = ctx.as("alice");
    bob = ctx.as("bob");
    mallory = ctx.as("mallory");
    admin = ctx.as("root");
    for (const who of [alice, bob, mallory, admin]) {
      await who.mutation(api.users.store, {});
    }
    // The only way to become admin: server-side change (CLI / DB), never the client.
    await ctx.t.run(async (c) => {
      const users = await c.db.query("users").collect();
      const root = users.find((u) => u.name === "root")!;
      await c.db.patch(root._id, { role: "admin" });
    });
    toolId = await createTool();
  });

  describe("authentication", () => {
    it("rejects anonymous calls to protected functions", async () => {
      await expectCode(ctx.t.query(api.tools.listAll, {}), "UNAUTHENTICATED");
      await expectCode(
        ctx.t.mutation(api.tools.create, {
          name: "x1",
          category: "other",
          condition: "good",
          description: "",
        }),
        "UNAUTHENTICATED",
      );
      await expectCode(ctx.t.query(api.loans.myRequests, {}), "UNAUTHENTICATED");
    });

    it("always creates new users with the plain 'user' role", async () => {
      const me = await ctx.as("newcomer").mutation(api.users.store, {});
      expect(me).toBeTruthy();
      const profile = await ctx.as("newcomer").query(api.users.me, {});
      expect(profile?.role).toBe("user");
      expect(profile?.trustedLender).toBe(false);
    });
  });

  describe("public page data minimization", () => {
    it("exposes only name and category of available tools", async () => {
      const list = await ctx.t.query(api.tools.listPublic, {});
      expect(list).toEqual([{ name: "Cordless drill", category: "power tools" }]);
      expect(Object.keys(list[0]).sort()).toEqual(["category", "name"]);
    });

    it("hides tools that are on loan", async () => {
      const loanId = await bob.mutation(api.loans.request, {
        toolId,
        startDate: inDays(1),
        endDate: inDays(2),
      });
      await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
      expect(await ctx.t.query(api.tools.listPublic, {})).toEqual([]);
    });
  });

  describe("listings", () => {
    it("lets only the owner edit a listing", async () => {
      const edit = { toolId, name: "Renamed", category: "other" as const, condition: "fair" as const, description: "" };
      await expectCode(mallory.mutation(api.tools.update, edit), "FORBIDDEN");
      await expectCode(admin.mutation(api.tools.update, edit), "FORBIDDEN");
      await alice.mutation(api.tools.update, edit);
    });

    it("lets owners delete their own listing but not someone else's", async () => {
      await expectCode(mallory.mutation(api.tools.remove, { toolId }), "FORBIDDEN");
      await alice.mutation(api.tools.remove, { toolId });
      expect(await ctx.t.query(api.tools.listPublic, {})).toEqual([]);
    });

    it("lets an admin remove any listing", async () => {
      await admin.mutation(api.tools.remove, { toolId });
      expect(await ctx.t.query(api.tools.listPublic, {})).toEqual([]);
    });

    it("refuses to remove a tool that is on loan", async () => {
      const loanId = await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) });
      await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
      await expectCode(alice.mutation(api.tools.remove, { toolId }), "TOOL_ON_LOAN");
      await expectCode(admin.mutation(api.tools.remove, { toolId }), "TOOL_ON_LOAN");
    });

    it("validates input", async () => {
      await expectCode(
        alice.mutation(api.tools.create, { name: " ", category: "other", condition: "good", description: "" }),
        "INVALID_NAME",
      );
    });
  });

  describe("loan requests", () => {
    it("blocks borrowing your own tool", async () => {
      await expectCode(
        alice.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) }),
        "OWN_TOOL",
      );
    });

    it("validates dates", async () => {
      const req = (startDate: string, endDate: string) =>
        bob.mutation(api.loans.request, { toolId, startDate, endDate });
      await expectCode(req("not-a-date", inDays(2)), "INVALID_START_DATE");
      await expectCode(req(inDays(3), inDays(1)), "INVALID_RANGE");
      await expectCode(req(inDays(-2), inDays(1)), "START_IN_PAST");
      await expectCode(req(inDays(1), inDays(60)), "RANGE_TOO_LONG");
    });

    it("blocks a second pending request and overlapping approved dates", async () => {
      const loanId = await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(3) });
      await expectCode(
        bob.mutation(api.loans.request, { toolId, startDate: inDays(5), endDate: inDays(6) }),
        "ALREADY_REQUESTED",
      );
      await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
      await expectCode(
        mallory.mutation(api.loans.request, { toolId, startDate: inDays(2), endDate: inDays(4) }),
        "DATES_UNAVAILABLE",
      );
      // Non-overlapping dates are still fine.
      await mallory.mutation(api.loans.request, { toolId, startDate: inDays(10), endDate: inDays(11) });
    });

    it("only the lender can approve or decline", async () => {
      const loanId = await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) });
      for (const who of [bob, mallory, admin]) {
        await expectCode(who.mutation(api.loans.respond, { loanId, decision: "approve" }), "FORBIDDEN");
      }
      await alice.mutation(api.loans.respond, { loanId, decision: "decline" });
      await expectCode(alice.mutation(api.loans.respond, { loanId, decision: "approve" }), "NOT_PENDING");
    });

    it("only the lender or an admin can mark a loan as returned", async () => {
      const loanId = await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) });
      await expectCode(alice.mutation(api.loans.markReturned, { loanId }), "NOT_APPROVED");
      await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
      await expectCode(bob.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
      await expectCode(mallory.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
      await alice.mutation(api.loans.markReturned, { loanId });
      // The tool is available again.
      expect(await ctx.t.query(api.tools.listPublic, {})).toHaveLength(1);
    });

    it("lets an admin mark any approved loan as returned", async () => {
      const loanId = await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) });
      await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
      await admin.mutation(api.loans.markReturned, { loanId });
    });
  });

  describe("views are scoped to the caller", () => {
    it("shows each person only their own requests", async () => {
      await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) });
      expect(await bob.query(api.loans.myRequests, {})).toHaveLength(1);
      expect(await mallory.query(api.loans.myRequests, {})).toHaveLength(0);
      expect(await alice.query(api.loans.incomingRequests, {})).toHaveLength(1);
      expect(await mallory.query(api.loans.incomingRequests, {})).toHaveLength(0);
      expect(await bob.query(api.loans.incomingRequests, {})).toHaveLength(0);
    });
  });

  describe("admin-only functions", () => {
    it("rejects non-admins", async () => {
      const target = (await alice.query(api.users.me, {}))!._id;
      for (const who of [alice, bob, mallory]) {
        await expectCode(who.query(api.users.listForAdmin, {}), "FORBIDDEN");
        await expectCode(who.query(api.loans.listAll, {}), "FORBIDDEN");
        await expectCode(who.mutation(api.users.setTrustedLender, { userId: target, trusted: true }), "FORBIDDEN");
      }
    });

    it("lets an admin view all loans and mark a Trusted Lender", async () => {
      await bob.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(2) });
      expect(await admin.query(api.loans.listAll, {})).toHaveLength(1);

      const target = (await alice.query(api.users.me, {}))!._id;
      await admin.mutation(api.users.setTrustedLender, { userId: target, trusted: true });
      expect((await alice.query(api.users.me, {}))?.trustedLender).toBe(true);
      const tools = await bob.query(api.tools.listAll, {});
      expect(tools[0].ownerTrusted).toBe(true);
    });
  });
});
