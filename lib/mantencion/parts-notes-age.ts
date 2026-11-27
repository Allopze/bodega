import type { PartsNoteAgeKey } from "@/lib/services/mantencion/parts/types"

/**
 * Antigüedad de las notas de pedido en la bandeja (fase 2, punto 4). Módulo PURO: lo leen el servicio (que calcula la
 * edad en SQL), la página, el gráfico y la barra de filtros (componentes de cliente), así que no importa nada de la base.
 *
 * La edad es de DÍAS CIVILES de Chile entre el día en que la nota llegó a su estado actual (`status_since`: el último
 * evento de su historial, lo mismo que dice «En este estado hace X») y hoy. Nunca horas transcurridas: lo que cambió de
 * estado ayer a las 23:00 tiene 1 día esta mañana. Una sola cuenta (en SQL, `noteAgeDaysSql`) alimenta la fila, los
 * tramos del gráfico y el filtro de la URL, para que no puedan discrepar.
 */

export const NOTE_AGE_BUCKETS = [
  { key: "0-2", label: "0–2 días", min: 0, max: 2 },
  { key: "3-6", label: "3–6 días", min: 3, max: 6 },
  { key: "7-13", label: "7–13 días", min: 7, max: 13 },
  { key: "14+", label: "14 días o más", min: 14, max: null },
] as const satisfies ReadonlyArray<{ key: PartsNoteAgeKey; label: string; min: number; max: number | null }>

export type NoteAgeCounts = Record<PartsNoteAgeKey, number>

export const EMPTY_NOTE_AGE_COUNTS: Readonly<NoteAgeCounts> = { "0-2": 0, "3-6": 0, "7-13": 0, "14+": 0 }

/** Tramo de una edad en días. Una edad negativa (reloj adelantado) cuenta como reciente. */
export function noteAgeBucketKey(days: number): PartsNoteAgeKey {
  const whole = Math.max(0, Math.floor(days))
  // El último tramo no tiene techo, así que `find` siempre acierta.
  return NOTE_AGE_BUCKETS.find((bucket) => bucket.max === null || whole <= bucket.max)!.key
}

/**
 * `?antiguedad=` es entrada del usuario: sólo pasan las claves de tramo. Un `+` sin codificar llega como espacio
 * (`?antiguedad=14+` → «14 »), así que «14» a secas también vale como «14+».
 */
export function parseNoteAgeParam(value: string | string[] | undefined): PartsNoteAgeKey | undefined {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim()
  if (!raw) return undefined
  const key = raw === "14" ? "14+" : raw
  return NOTE_AGE_BUCKETS.find((bucket) => bucket.key === key)?.key
}

export function noteAgeBucketLabel(key: string): string | null {
  return NOTE_AGE_BUCKETS.find((bucket) => bucket.key === key)?.label ?? null
}

/** La respuesta que el gráfico da antes que el dibujo: cuántas notas hay y cuántas llevan 14 días o más en su estado. */
export function noteAgeSummary(counts: NoteAgeCounts, active: PartsNoteAgeKey | undefined): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (total === 0) return ""
  const notes = (count: number) => `${count} ${count === 1 ? "nota" : "notas"}`
  if (active) return `Filtrando por «${noteAgeBucketLabel(active)}»: ${counts[active]} de ${notes(total)}.`
  const old = counts["14+"]
  if (old === 0) return `${notes(total)}; ninguna lleva 14 días o más en su estado.`
  return `${notes(total)}; ${old} ${old === 1 ? "lleva" : "llevan"} 14 días o más en su estado.`
}
