import { plural } from "./format"

/**
 * «Marcar como revisados» en lote, en Registros firmados. Módulo puro: lo usan la lista
 * (qué filas se pueden elegir y qué dice la barra), la acción y el servicio (el tope y el
 * texto del resultado) y sus pruebas.
 *
 * Sólo «revisado» va en lote: observar pide un texto por registro y anular, un motivo
 * (y es destructivo), así que siguen siendo caso por caso.
 */

/** Tope de registros por lote. El servidor lo vuelve a exigir. */
export const MAX_REVIEW_BATCH = 200

/**
 * ¿Admite marcarse como revisado? Lo vigente que no está revisado todavía: pendiente u
 * observado (marcarlo cierra la observación, como de a uno). Un anulado no se revisa y uno
 * ya revisado no tiene nada que hacer. Es la misma regla de `markRecordReviewed`.
 */
export function isReviewableRecord(row: { status: string; review: string }): boolean {
  return row.status !== "anulado" && row.review !== "revisado"
}

export interface RecordSelection {
  /** Los elegidos que siguen estando en la página y admiten revisión, en el orden de la lista. */
  ids: string[]
  count: number
  /** Más que el tope de un lote: no se ofrece la acción. */
  tooMany: boolean
}

/**
 * Lo elegido, reducido a lo que se puede enviar. Un registro que salió de la página (otra
 * pestaña, otro filtro) o que dejó de admitir revisión se descarta en silencio: la selección
 * nunca viaja con ids que la lista ya no muestra.
 */
export function summarizeRecordSelection(
  rows: ReadonlyArray<{ id: string; status: string; review: string }>,
  selected: ReadonlySet<string>,
): RecordSelection {
  const ids = rows.filter((row) => selected.has(row.id) && isReviewableRecord(row)).map((row) => row.id)
  return { ids, count: ids.length, tooMany: ids.length > MAX_REVIEW_BATCH }
}

/** Por qué un registro se saltó. */
export type ReviewSkipReason = "ya_revisado" | "anulado" | "no_encontrado"

export interface ReviewBatchCounts {
  marked: number
  skipped: ReadonlyArray<{ reason: ReviewSkipReason }>
}

const registros = (n: number) => plural(n, "registro", "registros")

/**
 * El texto con el que se avisa el resultado: «12 registros marcados como revisados; 2 ya
 * estaban revisados». Lo que no se marcó se dice por motivo, sin enumerar folios.
 */
export function reviewBatchMessage({ marked, skipped }: ReviewBatchCounts): string {
  const count = (reason: ReviewSkipReason) => skipped.filter((item) => item.reason === reason).length
  const already = count("ya_revisado")
  const voided = count("anulado")
  const missing = count("no_encontrado")

  const parts: string[] = []
  if (marked > 0) parts.push(`${registros(marked)} ${marked === 1 ? "marcado" : "marcados"} como ${marked === 1 ? "revisado" : "revisados"}`)
  if (already > 0) parts.push(`${already === 1 ? "1 ya estaba revisado" : `${already} ya estaban revisados`}`)
  if (voided > 0) parts.push(`${voided === 1 ? "1 está anulado" : `${voided} están anulados`}`)
  if (missing > 0) parts.push(`${missing === 1 ? "1 no se encontró" : `${missing} no se encontraron`}`)
  if (parts.length === 0) return "No había registros que marcar."
  const text = parts.join("; ")
  return marked > 0 ? text : `No se marcó ninguno: ${text}`
}
