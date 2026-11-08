// Convex validates the Clerk JWT (template named "convex") against this issuer.
// Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard (not in code).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
