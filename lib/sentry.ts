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

let initialized = false

function ensureInit() {
  if (initialized || !SENTRY_DSN) return
  if (process.env.NODE_ENV !== "production") return

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
    // Redact PII before sending
    beforeSend(event) {
      if (event.request?.headers) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { cookie, authorization, ...safe } = event.request.headers as Record<string, string>
        event.request.headers = safe
      }
      return event
    },
  })
  initialized = true
}

export const sentry = {
  captureException(error: unknown, context?: Record<string, unknown>) {
    ensureInit()
    if (!SENTRY_DSN) return // silently skip if not configured
    Sentry.captureException(error, { extra: context })
  },

  captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
    ensureInit()
    if (!SENTRY_DSN) return
    Sentry.captureMessage(message, level)
  },

  setUser(userId: string, email?: string) {
    ensureInit()
    if (!SENTRY_DSN) return
    Sentry.setUser({ id: userId, email })
  },

  setTag(key: string, value: string) {
    ensureInit()
    if (!SENTRY_DSN) return
    Sentry.setTag(key, value)
  },
}
