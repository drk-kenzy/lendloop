/**
 * HMAC-SHA256 helpers shared by the outgoing webhook (Convex -> n8n) and the
 * incoming HTTP endpoints (n8n -> Convex). Uses Web Crypto only, so it runs in
 * the default Convex runtime.
 *
 * Signed message format (identical on both sides, see n8n/workflows):
 *   `${timestampSeconds}.${METHOD}.${pathname}.${rawBody}`
 * Binding the method and path stops a captured signature from being replayed
 * against a different endpoint; the timestamp limits replay in time.
 */

const encoder = new TextEncoder();

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return toHex(signature);
}

/** Constant-time string comparison (no early exit on the first difference). */
export function timingSafeEqual(a: string, b: string): boolean {
  const lengthDiff = a.length ^ b.length;
  let diff = lengthDiff;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function buildSignedMessage(
  timestamp: string,
  method: string,
  pathname: string,
  body: string,
): string {
  return `${timestamp}.${method.toUpperCase()}.${pathname}.${body}`;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "mismatch" };

export async function verifySignature(args: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  body: string;
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, method, pathname, body } = args;
  if (!timestamp || !signature) return { ok: false, reason: "missing" };

  const ts = Number(timestamp);
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected = await hmacSha256Hex(
    secret,
    buildSignedMessage(timestamp, method, pathname, body),
  );
  return timingSafeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}
