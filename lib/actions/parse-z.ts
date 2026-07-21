import type { z } from "zod"

/**
 * Resultado de `parseZ`. La rama `ok:false` es estructuralmente compatible
 * con `ActionState` (lib/validation/masters.ts) y se puede devolver
 * directamente desde una Server Action: `if (!parsed.ok) return parsed`.
 */
export type ParseZResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors: Record<string, string[]> }

const DEFAULT_MESSAGE = "Revisa los campos marcados."

/**
 * Valida `input` (unknown) contra un schema Zod en el boundary de una
 * Server Action, antes de reenviarlo al servicio. Nunca lanza: usa
 * `safeParse`, nunca `parse`.
 *
 * Esto es una capa ADICIONAL de defensa en el boundary — no reemplaza la
 * validación que ya hace el servicio (si la tiene).
 */
export function parseZ<T>(
  schema: z.ZodType<T>,
  input: unknown,
  message: string = DEFAULT_MESSAGE,
): ParseZResult<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  return { ok: true, data: parsed.data }
}
