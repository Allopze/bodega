import { isForeignKeyViolation, isUniqueViolation, safeActionMessage } from "@/lib/action-error"

/**
 * Rama de error de una Server Action. Es la misma forma que devuelve `parseZ`
 * y estructuralmente compatible con `ActionState`, así que se devuelve tal cual:
 * `catch (error) { return actionErrorResult(error, "No se pudo guardar.") }`.
 */
export type ActionErrorResult = {
  ok: false
  message: string
  fieldErrors?: Record<string, string[]>
}

export type ActionErrorOptions = {
  /**
   * Mensaje por constraint única (23505). La clave `"*"` cubre cualquier otra:
   * sin ella, una violación de unicidad cae al `fallback` genérico.
   */
  unique?: Record<string, string>
  /** Mensaje ante una violación de llave foránea (23503). */
  foreignKey?: string
}

const FIELDS_MESSAGE = "Revisa los campos marcados"

type ZodLikeIssue = { path?: readonly PropertyKey[]; message?: string }

/**
 * Convierte cualquier error lanzado por un servicio en el resultado que ve el
 * usuario. Sustituye los `catch` que se repetían a mano en cada `actions.ts`, y
 * sobre todo los que no estaban: ahí un `ZodError` lanzado por el servicio
 * terminaba en «No se pudo completar la operación.» y la persona no sabía qué
 * corregir.
 *
 * - `ZodError` (detectado por forma, como en `safeActionMessage`): devuelve
 *   `fieldErrors` por campo y, en `message`, la primera regla incumplida, para
 *   que el aviso sirva aunque el diálogo todavía no pinte los errores por campo.
 *   Un issue sin `path` (un `superRefine` del formulario) es el mensaje mismo.
 * - 23505 / 23503: el mensaje que indique quien llama.
 * - Todo lo demás: `safeActionMessage`, que muestra los errores de negocio y
 *   oculta los del driver.
 */
export function actionErrorResult(
  error: unknown,
  fallback: string,
  options: ActionErrorOptions = {},
): ActionErrorResult {
  const issues = zodIssues(error)
  if (issues) return fromZodIssues(issues)

  if (options.unique && isUniqueViolation(error)) {
    const byConstraint = Object.entries(options.unique).find(
      ([constraint]) => constraint !== "*" && isUniqueViolation(error, constraint),
    )
    const message = byConstraint?.[1] ?? options.unique["*"]
    if (message) return { ok: false, message }
  }
  if (options.foreignKey && isForeignKeyViolation(error)) {
    return { ok: false, message: options.foreignKey }
  }
  return { ok: false, message: safeActionMessage(error, fallback) }
}

function zodIssues(error: unknown): ZodLikeIssue[] | null {
  if (!(error instanceof Error)) return null
  const issues = (error as { issues?: unknown }).issues
  return Array.isArray(issues) ? (issues as ZodLikeIssue[]) : null
}

function fromZodIssues(issues: ZodLikeIssue[]): ActionErrorResult {
  const fieldErrors: Record<string, string[]> = {}
  let formMessage: string | undefined
  let firstFieldMessage: string | undefined

  for (const issue of issues) {
    const message = typeof issue.message === "string" && issue.message.trim() ? issue.message.trim() : undefined
    if (!message) continue
    const key = issue.path && issue.path.length > 0 ? String(issue.path[0]) : undefined
    if (!key) {
      formMessage ??= message
      continue
    }
    ;(fieldErrors[key] ??= []).push(message)
    firstFieldMessage ??= message
  }

  const message = formMessage
    ?? (firstFieldMessage ? `${FIELDS_MESSAGE}: ${firstFieldMessage}` : `${FIELDS_MESSAGE}.`)
  return Object.keys(fieldErrors).length > 0 ? { ok: false, message, fieldErrors } : { ok: false, message }
}
