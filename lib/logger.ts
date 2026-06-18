/**
 * Structured logger.
 *
 * In production the log level defaults to "warn" (hides debug/info).
 * Use `logger.error` for unexpected failures and `logger.warn` for recoverable issues.
 * `logger.info` is visible only in development.
 *
 * Security audit S-14: arguments are redacted before they reach stdout/stderr.
 * Object values under sensitive keys (password, rut, email, token, …) are
 * replaced with "[redacted]", and email/RUT patterns inside free strings are
 * masked. This keeps PII (RUT, email, hashed passwords, tokens) out of logs
 * that may be shipped to an external SaaS (Datadog, Sentry, …) — relevant for
 * Ley 19.628 (Chile) / GDPR.
 */
const LEVEL = process.env.NODE_ENV === "production" ? "warn" : "debug"

const PREFIX = "[chome]"

const SENSITIVE_KEY = /^(password|hashed_?password|token|token_?hash|secret|authorization|cookie|rut|email|phone|telefono)$/i

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// Chilean RUT: 7-8 digits + dash + check digit (with or without dots).
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g

function redactString(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(RUT_RE, "[rut]")
}

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value)
  if (value === null || typeof value !== "object") return value
  if (depth > 4) return "[depth-limit]"
  if (seen.has(value as object)) return "[circular]"
  seen.add(value as object)

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen))

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(val, depth + 1, seen)
  }
  return out
}

function shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
  const order = ["debug", "info", "warn", "error"]
  return order.indexOf(level) >= order.indexOf(LEVEL as "debug")
}

function formatArgs(args: unknown[]): string[] {
  return args.map((a) => {
    if (a instanceof Error) return redactString(a.stack ?? a.message)
    if (typeof a === "string") return redactString(a)
    if (a !== null && typeof a === "object") {
      try {
        return JSON.stringify(redact(a))
      } catch {
        return "[unserializable]"
      }
    }
    return String(a)
  })
}

export const logger = {
  debug(...args: unknown[]) {
    if (!shouldLog("debug")) return
    console.debug(PREFIX, ...formatArgs(args))
  },

  info(...args: unknown[]) {
    if (!shouldLog("info")) return
    console.info(PREFIX, ...formatArgs(args))
  },

  warn(...args: unknown[]) {
    if (!shouldLog("warn")) return
    console.warn(PREFIX, ...formatArgs(args))
  },

  error(...args: unknown[]) {
    if (!shouldLog("error")) return
    console.error(PREFIX, ...formatArgs(args))
  },
}
