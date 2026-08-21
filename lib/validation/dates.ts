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
