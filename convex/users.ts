import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, requireAdmin } from "./lib/auth";

/**
 * Called by the client right after sign-in. Creates the user row on first
 * login (always as role "user") and refreshes name/email afterwards.
 * The role is NEVER taken from the client or from the JWT.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");

    const name =
      identity.name ?? identity.givenName ?? identity.nickname ?? "Neighbor";
    const email = identity.email;

    const existing = await getCurrentUser(ctx);
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/** Admin only: list members so a lender can be marked "Trusted Lender". */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("NOT_FOUND");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Bootstrap the first admin from the CLI (internal functions are not callable
 * from clients):
 *   npx convex run users:setRoleByEmail '{"email":"you@example.com","role":"admin"}'
 */
export const setRoleById = internalMutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, { userId, role }) => {
    await ctx.db.patch(userId, { role });
    return userId;
  },
});

export const setRoleByEmail = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
  },
  handler: async (ctx, { email, role }) => {
    const users = await ctx.db.query("users").collect();
    const target = users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!target) throw new ConvexError("USER_NOT_FOUND");
    await ctx.db.patch(target._id, { role });
    return target._id;
  },
});
