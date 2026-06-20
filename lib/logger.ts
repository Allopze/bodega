/**
 * Structured logger with JSON output.
 *
 * In production the log level defaults to "warn" (hides debug/info).
 * Use `logger.error` for unexpected failures and `logger.warn` for recoverable issues.
 * `logger.info` is visible only in development.
 *
 * Each log line is a JSON object with: level, timestamp, message, and optional data.
 * This format is parseable by log aggregators (Datadog, ELK, Axiom, etc.).
 *
 * Security audit S-14 / DEVOPS-04: arguments are redacted before they reach stdout.
 * Object values under sensitive keys (password, rut, email, token, …) are
 * replaced with "[redacted]", and email/RUT patterns inside free strings are
 * masked. This keeps PII (RUT, email, hashed passwords, tokens) out of logs
 * that may be shipped to an external SaaS — relevant for Ley 19.628 (Chile) / GDPR.
 */
const LEVEL = process.env.NODE_ENV === "production" ? "warn" : "debug"

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

interface LogEntry {
  level: "debug" | "info" | "warn" | "error"
  timestamp: string
  message: string
  data?: unknown
  correlationId?: string
  error?: string
}

import { sentry } from "@/lib/sentry"

function writeLog(level: "debug" | "info" | "warn" | "error", args: unknown[]): void {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message: "",
  }

  // Extract correlationId from first arg if it's an object with correlationId
  let startIdx = 0
  if (args.length > 0 && typeof args[0] === "object" && args[0] !== null && "correlationId" in (args[0] as Record<string, unknown>)) {
    const first = args[0] as Record<string, unknown>
    entry.correlationId = String(first.correlationId)
    startIdx = 1
  }

  // Build message from the remaining args
  const remainingArgs = args.slice(startIdx)
  if (remainingArgs.length === 1) {
    const arg = remainingArgs[0]
    if (arg instanceof Error) {
      entry.message = redactString(arg.message)
      entry.error = redactString(arg.stack ?? arg.message)
    } else if (typeof arg === "string") {
      entry.message = redactString(arg)
    } else if (arg !== null && typeof arg === "object") {
      entry.data = redact(arg)
    } else {
      entry.message = String(arg)
    }
  } else if (remainingArgs.length > 1) {
    // First non-object/non-error arg is message, rest is data
    if (typeof remainingArgs[0] === "string") {
      entry.message = redactString(remainingArgs[0])
      entry.data = redact(remainingArgs.slice(1))
    } else {
      entry.message = redactString(remainingArgs.map((a) => String(a)).join(" "))
    }
  }

  const output = JSON.stringify(entry)
  const logFn = level === "error" ? console.error
    : level === "warn" ? console.warn
    : level === "info" ? console.info
    : console.debug
  logFn(output)
}

export const logger = {
  debug(...args: unknown[]) {
    writeLog("debug", args)
  },

  info(...args: unknown[]) {
    writeLog("info", args)
  },

  warn(...args: unknown[]) {
    writeLog("warn", args)
  },

  error(...args: unknown[]) {
    writeLog("error", args)
  },
}
