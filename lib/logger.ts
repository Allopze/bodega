/**
 * Structured logger.
 *
 * In production the log level defaults to "warn" (hides debug/info).
 * Use `logger.error` for unexpected failures and `logger.warn` for recoverable issues.
 * `logger.info` is visible only in development.
 */
const LEVEL = process.env.NODE_ENV === "production" ? "warn" : "debug"

const PREFIX = "[chome]"

function shouldLog(level: "debug" | "info" | "warn" | "error"): boolean {
  const order = ["debug", "info", "warn", "error"]
  return order.indexOf(level) >= order.indexOf(LEVEL as "debug")
}

function formatArgs(args: unknown[]): string[] {
  return args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a)))
}

export const logger = {
  debug(...args: unknown[]) {
    if (!shouldLog("debug")) return
    // eslint-disable-next-line no-console
    console.debug(PREFIX, ...formatArgs(args))
  },

  info(...args: unknown[]) {
    if (!shouldLog("info")) return
    // eslint-disable-next-line no-console
    console.info(PREFIX, ...formatArgs(args))
  },

  warn(...args: unknown[]) {
    if (!shouldLog("warn")) return
    // eslint-disable-next-line no-console
    console.warn(PREFIX, ...formatArgs(args))
  },

  error(...args: unknown[]) {
    if (!shouldLog("error")) return
    // eslint-disable-next-line no-console
    console.error(PREFIX, ...formatArgs(args))
  },
}
