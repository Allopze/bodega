import { z } from "zod"

/**
 * Fecha civil real en formato `YYYY-MM-DD`.
 *
 * La regex sola deja pasar `2026-02-31` y `2026-13-01`. Esos strings llegan
 * crudos a SQL (`${columna}::date`) y revientan la consulta completa, no la
 * fila: el error no aparece al guardar sino al abrir la pantalla que la lee.
 * `new Date("2026-02-31")` no falla —normaliza a marzo—, así que se compara el
 * resultado contra la entrada.
 */
export function isCivilDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function civilDate(message = "Fecha inválida") {
  return z.string().refine(isCivilDate, message)
}

/**
 * Rango de fechas civiles `from`/`to`, con `from <= to` validado en el propio
 * schema. Antes los importadores Aramco/Copec validaban el orden a mano
 * después del parse, con mensajes distintos por módulo.
 */
export function civilDateRange(options?: {
  required?: boolean
  message?: string
}) {
  const date = civilDate()
  const rangeMessage = options?.message ?? "La fecha desde no puede ser posterior a la fecha hasta"

  if (options?.required) {
    return z
      .object({ from: date, to: date })
      .superRefine((data: { from: string; to: string }, ctx) => {
        if (data.from > data.to) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: rangeMessage })
        }
      })
  }

  return z
    .object({ from: date.optional(), to: date.optional() })
    .superRefine((data: { from?: string; to?: string }, ctx) => {
      if (data.from && data.to && data.from > data.to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: rangeMessage })
      }
    })
}
