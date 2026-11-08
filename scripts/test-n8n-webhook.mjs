// Smoke test for the n8n request-notification webhook (HMAC verification).
//   LENDLOOP_SHARED_SECRET=... node scripts/test-n8n-webhook.mjs [webhookUrl]
import { createHmac } from "node:crypto";

const secret = process.env.LENDLOOP_SHARED_SECRET;
const url = process.argv[2] ?? "http://localhost:5678/webhook/lendloop-request-events";
if (!secret) {
  console.error("Set LENDLOOP_SHARED_SECRET (same value as in Convex and n8n).");
  process.exit(1);
}
const pathname = new URL(url).pathname;

function sign(body, ts) {
  return createHmac("sha256", secret).update(`${ts}.POST.${pathname}.${body}`).digest("hex");
}

async function send(label, { body, ts = String(Math.floor(Date.now() / 1000)), signature, expect }) {
  const headers = { "content-type": "application/json" };
  if (ts !== null) headers["x-lendloop-timestamp"] = ts;
  const sig = signature === undefined ? sign(body, ts) : signature;
  if (sig !== null) headers["x-lendloop-signature"] = sig;
  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  const ok = res.status === expect;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${res.status} ${text}`);
  return ok;
}

const eventId = `smoke-test:${Date.now()}`;
const payload = JSON.stringify({
  eventId,
  occurredAt: new Date().toISOString(),
  event: "created",
  loan: { id: "demo", toolName: "Cordless drill", startDate: "2030-01-01", endDate: "2030-01-03" },
  recipient: { name: "Alice", email: "alice@example.test" },
});

const results = [
  await send("valid signature is accepted", { body: payload, expect: 200 }),
  await send("same eventId is acknowledged as duplicate", { body: payload, expect: 200 }),
  await send("tampered body is rejected", { body: payload.replace("Cordless", "Stolen  "), signature: sign(payload, String(Math.floor(Date.now() / 1000))), expect: 401 }),
  await send("wrong secret is rejected", { body: payload, signature: "0".repeat(64), expect: 401 }),
  await send("stale timestamp is rejected", { body: payload, ts: String(Math.floor(Date.now() / 1000) - 3600), expect: 401 }),
  await send("missing headers are rejected", { body: payload, ts: null, signature: null, expect: 401 }),
];
process.exit(results.every(Boolean) ? 0 : 1);
