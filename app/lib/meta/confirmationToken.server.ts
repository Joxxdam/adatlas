import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { metaPayloadHash } from "./preflight.ts";

type TokenRecord = { payloadHash: string; expiresAt: number; used: boolean };

export function createMetaConfirmationTokenService(options?: {
  secret?: string;
  ttlMs?: number;
  now?: () => number;
}) {
  const secret = options?.secret || randomBytes(32).toString("hex");
  const ttlMs = options?.ttlMs || 10 * 60_000;
  const now = options?.now || Date.now;
  const records = new Map<string, TokenRecord>();

  function sign(value: string) {
    return createHmac("sha256", secret).update(value).digest("hex");
  }

  return {
    issue(payload: unknown) {
      const nonce = randomBytes(18).toString("base64url");
      const payloadHash = metaPayloadHash(payload);
      const expiresAt = now() + ttlMs;
      const body = `${nonce}.${expiresAt}.${payloadHash}`;
      const token = `${body}.${sign(body)}`;
      records.set(nonce, { payloadHash, expiresAt, used: false });
      return { token, payloadHash, expiresAt: new Date(expiresAt).toISOString() };
    },
    consume(token: string, payload: unknown) {
      const [nonce, expiresAtRaw, payloadHash, signature] = token.split(".");
      if (!nonce || !expiresAtRaw || !payloadHash || !signature) return false;
      const body = `${nonce}.${expiresAtRaw}.${payloadHash}`;
      const expected = Buffer.from(sign(body));
      const received = Buffer.from(signature);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
      const record = records.get(nonce);
      if (!record || record.used || record.expiresAt < now()) return false;
      if (record.payloadHash !== metaPayloadHash(payload) || record.payloadHash !== payloadHash)
        return false;
      record.used = true;
      return true;
    },
  };
}

export const metaConfirmationTokens = createMetaConfirmationTokenService({
  secret: process.env.META_APP_SECRET || process.env.ADATLAS_INTERNAL_API_TOKEN || undefined,
});
