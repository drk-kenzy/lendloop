import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { categoryValidator, conditionValidator } from "./schema";

function cleanText(
  value: string,
  label: string,
  min: number,
  max: number,
): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ConvexError(`INVALID_${label.toUpperCase()}`);
  }
  return trimmed;
}

/**
 * PUBLIC (no auth). Data minimization: only name + category of tools that are
 * currently available. No ids, no owner, no loan information.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(200);
    return tools
      .filter((t) => !t.onLoan && !t.deletedAt)
      .map((t) => ({ name: t.name, category: t.category }));
  },
});

/** Signed-in users: every tool with availability, optionally by category. */
export const listAll = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const rows = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .collect()
      : await ctx.db.query("tools").collect();
    const tools = rows.filter((t) => !t.deletedAt);

    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          available: !t.onLoan,
          isMine: t.ownerId === me._id,
          ownerTrusted: owner?.trustedLender ?? false,
        };
      }),
    );
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    return tools
      .filter((t) => !t.deletedAt)
      .map((t) => ({
        _id: t._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        available: !t.onLoan,
      }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name: cleanText(args.name, "name", 2, 80),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "description", 0, 500),
      onLoan: false,
    });
  },
});

/** Only the owner can edit a listing (admins can remove, not edit). */
export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt) throw new ConvexError("NOT_FOUND");
    if (tool.ownerId !== me._id) throw new ConvexError("FORBIDDEN");
    await ctx.db.patch(toolId, {
      name: cleanText(fields.name, "name", 2, 80),
      category: fields.category,
      condition: fields.condition,
      description: cleanText(fields.description, "description", 0, 500),
    });
  },
});

/**
 * The owner can delete their own listing; an admin can remove any listing.
 * A tool that is currently on loan cannot be removed (mark it returned first).
 * Pending requests are declined and the borrowers are notified.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("NOT_FOUND");
    if (tool.ownerId !== me._id && me.role !== "admin") {
      throw new ConvexError("FORBIDDEN");
    }
    if (tool.onLoan) throw new ConvexError("TOOL_ON_LOAN");

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    for (const loan of loans) {
      if (loan.status === "pending") {
        await ctx.db.patch(loan._id, { status: "declined" });
        await ctx.scheduler.runAfter(0, internal.automation.sendLoanEvent, {
          loanId: loan._id,
          event: "declined",
          attempt: 0,
        });
      }
    }
    // Soft delete so loan history keeps a valid reference to the tool.
    await ctx.db.patch(toolId, { deletedAt: Date.now() });
  },
});
