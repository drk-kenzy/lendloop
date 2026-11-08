import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { todayISO } from "./lib/dates";
import { verifySignature } from "./lib/hmac";

const http = httpRouter();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * n8n -> Convex authentication. Every request must carry a fresh HMAC
 * signature over `${timestamp}.${METHOD}.${pathname}.${body}`.
 * Returns the raw body on success, or an error Response.
 */
async function authenticate(
  request: Request,
): Promise<{ body: string } | { error: Response }> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return { error: json({ error: "not_configured" }, 503) };

  const body = await request.text();
  const result = await verifySignature({
    secret,
    timestamp: request.headers.get("x-lendloop-timestamp"),
    signature: request.headers.get("x-lendloop-signature"),
    method: request.method,
    pathname: new URL(request.url).pathname,
    body,
  });
  if (!result.ok) {
    // Same status for every failure so the endpoint leaks nothing.
    return { error: json({ error: "unauthorized" }, 401) };
  }
  return { body };
}

/** Overdue loans that still need a reminder today (read-only). */
http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if ("error" in auth) return auth.error;
    const today = todayISO();
    const loans = await ctx.runQuery(internal.automation.overdueForReminder, {
      today,
    });
    return json({ date: today, loans });
  }),
});

/** Write-back of a reminder result. Idempotent per loan and day. */
http.route({
  path: "/n8n/reminder-result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if ("error" in auth) return auth.error;

    let payload: unknown;
    try {
      payload = JSON.parse(auth.body);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const { loanId, date, status, detail } = (payload ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof loanId !== "string" ||
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      (status !== "sent" && status !== "failed") ||
      (detail !== undefined && typeof detail !== "string")
    ) {
      return json({ error: "invalid_payload" }, 400);
    }

    const normalized = ctx.runQuery(internal.automation.normalizeLoanId, {
      loanId,
    });
    const id = (await normalized) as Id<"loans"> | null;
    if (!id) return json({ error: "unknown_loan" }, 404);

    const result = await ctx.runMutation(internal.automation.recordReminder, {
      loanId: id,
      date,
      status,
      detail,
    });
    return json({ ok: true, duplicate: result.duplicate });
  }),
});

export default http;
