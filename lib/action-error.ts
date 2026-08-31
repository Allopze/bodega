import { logger } from "@/lib/logger"
import { userFacingErrorText } from "@/lib/user-facing-error"

/**
 * Mensaje seguro para devolverle al cliente desde una server action.
 *
 * Los servicios lanzan sus errores de negocio como `new Error("texto para el
 * usuario")`, y ésos sí deben mostrarse. Los del driver llegan envueltos en
 * `DrizzleQueryError`, cuyo `.message` es literalmente
 * `"Failed query: <SQL completo>\nparams: <valores>"`: mostrarlo en un toast
 * publica el esquema y los datos de la fila (pasaba con cualquier violación de
 * constraint, p.ej. dos usuarios asignando el mismo pendiente a la vez).
 * Un `ZodError` tampoco sirve: su `.message` es el JSON completo de issues.
 *
 * Ambos se detectan por forma (no por `instanceof`) para que sigan funcionando
 * si conviven dos copias del módulo en node_modules.
 */
export function safeActionMessage(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback

  const candidate = e as { query?: unknown; params?: unknown; issues?: unknown; cause?: unknown }
  const isDriverError = typeof candidate.query === "string" || candidate.cause !== undefined
  const isSchemaError = Array.isArray(candidate.issues)

  // Playwright adjunta un bloque de varios kilobytes con selectores, reintentos
  // y detalles de la página. El texto anterior a `Call log:` es el motivo que
  // los adaptadores redactan para el operador y sí resulta accionable.
  const message = userFacingErrorText(e.message)

  if (isDriverError || isSchemaError || message === null) {
    logger.error("[action] error interno no apto para el cliente", e)
    return fallback
  }
  return message
}

/**
 * Código Postgres 23503 = foreign_key_violation.
 *
 * Igual que con 23505, Drizzle envuelve el error del driver en un
 * `DrizzleQueryError` que no expone `.code` propio: el código real queda en
 * `.cause`, así que hay que mirar ambos niveles.
 */
export function isForeignKeyViolation(e: unknown): boolean {
  const hasCode = (candidate: unknown) =>
    typeof candidate === "object" && candidate !== null && "code" in candidate
    && (candidate as { code?: string }).code === "23503"

  if (hasCode(e)) return true
  return hasCode(e instanceof Error ? e.cause : undefined)
}
