import { timingSafeEqual } from "node:crypto"

/** Timing-safe comparison of an `Authorization: Bearer <secret>` header against the configured cron secret. */
export function verifyCronSecret(authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(authHeader)
  if (received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

export interface CronRequestHeaders {
  authorization: string | null
  forwardedFor?: string | null
  realIp?: string | null
  internalSecret?: string | null
}

/** First hop is trusted only when the reverse proxy owns X-Forwarded-For. */
export function cronRequestSource(headers: Pick<CronRequestHeaders, "forwardedFor" | "realIp">): string | null {
  const forwarded = headers.forwardedFor?.split(",")[0]?.trim()
  return forwarded || headers.realIp?.trim() || null
}

export function parseCronAllowedSources(value: string | undefined): string[] {
  return (value ?? "").split(",").map((source) => source.trim()).filter(Boolean)
}

/** Bearer plus a network allowlist. In production an empty allowlist denies by default. */
export function verifyCronRequest(
  headers: CronRequestHeaders,
  secret: string,
  allowedSources: string[],
  enforceSource: boolean,
): boolean {
  if (!verifyCronSecret(headers.authorization, secret)) return false
  if (!enforceSource) return true
  const source = cronRequestSource(headers)
  return source !== null && allowedSources.includes(source)
}

/**
 * Dedicated two-secret path for the private Docker scheduler, which calls the
 * app directly and has no trusted proxy IP header. The internal secret must be
 * distinct from CRON_SECRET; external requests still need the configured IP
 * allowlist.
 */
export function verifyCronInternalRequest(
  headers: Pick<CronRequestHeaders, "authorization" | "internalSecret">,
  cronSecret: string,
  internalSecret: string | undefined,
): boolean {
  if (!internalSecret || internalSecret === cronSecret || !verifyCronSecret(headers.authorization, cronSecret)) return false
  if (!headers.internalSecret) return false
  const expected = Buffer.from(internalSecret)
  const received = Buffer.from(headers.internalSecret)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
