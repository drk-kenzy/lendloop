import { ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Demo data for local development and for exercising the n8n workflows
 * without signing in. Internal (not callable from the browser) and disabled
 * unless ALLOW_SEED=true is set on the deployment:
 *
 *   npx convex env set ALLOW_SEED true
 *   npx convex run dev:seed
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.ALLOW_SEED !== "true") {
      throw new ConvexError("SEED_DISABLED");
    }
    const mk = (key: string, name: string, role: "admin" | "user") =>
      ctx.db.insert("users", {
        tokenIdentifier: `seed|${key}`,
        name,
        email: `${key}@example.test`,
        role,
        trustedLender: false,
      });
    const alice = await mk("alice", "Alice (admin)", "admin");
    const bob = await mk("bob", "Bob", "user");
    const carol = await mk("carol", "Carol", "user");

    const drill = await ctx.db.insert("tools", {
      ownerId: alice,
      name: "Cordless drill",
      category: "power tools",
      condition: "good",
      description: "18V, two batteries.",
      onLoan: false,
    });
    const ladder = await ctx.db.insert("tools", {
      ownerId: carol,
      name: "Extension ladder",
      category: "hand tools",
      condition: "fair",
      description: "3 m.",
      onLoan: true,
    });

    const day = 86_400_000;
    const iso = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

    const pending = await ctx.db.insert("loans", {
      toolId: drill,
      borrowerId: bob,
      lenderId: alice,
      startDate: iso(1),
      endDate: iso(3),
      status: "pending",
    });
    const overdue = await ctx.db.insert("loans", {
      toolId: ladder,
      borrowerId: bob,
      lenderId: carol,
      startDate: iso(-10),
      endDate: iso(-3),
      status: "approved",
    });
    return { pendingLoanId: pending, overdueLoanId: overdue };
  },
});
