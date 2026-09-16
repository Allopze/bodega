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

// Match both generic secrets and the DTE key-material vocabulary.  Keep this
// deliberately broad: the logger is the last boundary before stdout, so a
// false positive is preferable to a credential leaving the process.
const SENSITIVE_KEY = /(?:password|passphrase|hashed_?password|token|token_?hash|secret|authorization|cookie|rut(?:_?(?:usr|emp))?|email|importer_?email|phone|telefono|clave|cod_?emp|keyring|(?:private|encryption)_?key|ciphertext|envelope|(?:auth_)?tag|(?:initialization_?)?iv)/i

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// Chilean RUT: 7-8 digits + dash + check digit (with or without dots).
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g
const DTE_ENVELOPE_RE = /\benc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+\b/g
const SECRET_ASSIGNMENT_RE = /(["']?(?:password|passphrase|token|secret|authorization|cookie|clave|rut(?:_?(?:usr|emp))?|email|importer_?email|cod_?emp|keyring|(?:private|encryption)_?key|ciphertext|envelope|(?:auth_)?tag|(?:initialization_?)?iv)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}&]+)/gi

function redactString(value: string): string {
  return value
    .replace(DTE_ENVELOPE_RE, "[encrypted]")
    .replace(SECRET_ASSIGNMENT_RE, "$1[redacted]")
    .replace(EMAIL_RE, "[email]")
    .replace(RUT_RE, "[rut]")
}

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 4) return "[depth-limit]"
  if (typeof value === "string") return redactString(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value as object)) return "[circular]"
  seen.add(value as object)

  // `Object.entries(new Error(...))` es `[]`: sin esta rama un error registrado
  // junto a un contexto (`logger.error("[accion]", error)`) sale como `{}` y el
  // fallo queda sin diagnóstico.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: redactString(value.stack ?? value.message),
    }
  }

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


/**
 * Un objeto que sirve como CONTEXTO: ni `Error` (que se serializa aparte, con
 * su stack) ni arreglo (que es una lista de argumentos, no un contexto).
 */
function isContextObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !(value instanceof Error) && !Array.isArray(value)
}

function writeLog(level: "debug" | "info" | "warn" | "error", args: unknown[]): void {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message: "",
  }

  let rest = args

  // El `correlationId` sale del primer objeto, pero el RESTO de sus campos se
  // devuelve a la lista: descartar el objeto entero después de leerle un campo
  // se llevaba por delante el `err` que viajaba al lado.
  const head = rest[0]
  if (isContextObject(head) && "correlationId" in head) {
    const { correlationId, ...others } = head
    entry.correlationId = String(correlationId)
    rest = rest.slice(1)
    if (Object.keys(others).length > 0) rest = [others, ...rest]
  }

  // Firma estilo pino —`logger.error({ err, ...ctx }, "mensaje")`—, la que usan
  // los crons, la sincronización del portal DTE y la acreditación del PDTP.
  // Sin esta rama caían al fallback `args.map(String)` y salían como
  // "[object Object] <mensaje>", perdiendo el error y todo el contexto: un
  // fallo registrado pero indiagnosticable.
  if (rest.length > 1 && isContextObject(rest[0]) && typeof rest[1] === "string") {
    const [context, message, ...tail] = rest
    entry.message = redactString(message)
    entry.data = redact(tail.length > 0 ? [context, ...tail] : context)
    emit(level, entry)
    return
  }

  // Simétrico al anterior: `logger.error(error, { ...ctx })` conserva el stack
  // como `error` y el contexto como `data`, en vez de aplastar ambos.
  if (rest.length > 1 && rest[0] instanceof Error && isContextObject(rest[1])) {
    const [err, context, ...tail] = rest as [Error, Record<string, unknown>, ...unknown[]]
    entry.message = redactString(err.message)
    entry.error = redactString(err.stack ?? err.message)
    entry.data = redact(tail.length > 0 ? [context, ...tail] : context)
    emit(level, entry)
    return
  }

  // Build message from the remaining args
  const remainingArgs = rest
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

  emit(level, entry)
}

function emit(level: "debug" | "info" | "warn" | "error", entry: LogEntry): void {
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
