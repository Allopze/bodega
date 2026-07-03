import { timingSafeEqual } from "node:crypto"

/** Timing-safe comparison of an `Authorization: Bearer <secret>` header against the configured cron secret. */
export function verifyCronSecret(authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(authHeader)
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}
