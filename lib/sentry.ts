/**
 * Sentry wrapper for error tracking.
 *
 * Initializes @sentry/nextjs in production only.
 * In development, Sentry is a no-op to avoid noise.
 *
 * Usage:
 *   import { sentry } from "@/lib/sentry"
 *   sentry.captureException(error)
 *
 * Sentry DSN should be set in SENTRY_DSN env var (optional in dev).
 */
import * as Sentry from "@sentry/nextjs"

const SENTRY_DSN = process.env.SENTRY_DSN

// Sentry is initialized eagerly by sentry.server.config.ts / sentry.client.config.ts
// via withSentryConfig in next.config.ts. This wrapper re-exports the initialized
// Sentry client for use in logger.error and other manual capture calls.
const isReady = !!SENTRY_DSN

export const sentry = {
  captureException(error: unknown, context?: Record<string, unknown>) {
    if (!isReady) return
    Sentry.captureException(error, { extra: context })
  },

  captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
    if (!isReady) return
    Sentry.captureMessage(message, level)
  },

  setUser(userId: string, email?: string) {
    if (!isReady) return
    Sentry.setUser({ id: userId, email })
  },

  setTag(key: string, value: string) {
    if (!isReady) return
    Sentry.setTag(key, value)
  },
}
