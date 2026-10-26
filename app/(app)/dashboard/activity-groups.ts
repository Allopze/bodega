import type { OperationalActivityEntry } from "@/lib/services/operational-activity"

/**
 * Un renglón de "Actividad reciente" que puede resumir varios movimientos
 * idénticos seguidos ("Obligación PDTP reportada ×6").
 *
 * Es el primer movimiento del tramo —el más reciente, porque la lista llega
 * ordenada del más nuevo al más antiguo— más cuántos se juntaron y sus ids.
 */
export interface ActivityGroup extends OperationalActivityEntry {
  count: number
  ids: string[]
}

/**
 * Junta los movimientos **consecutivos** con la misma acción, faena y autor.
 *
 * Una carga masiva de obligaciones PDTP dejaba seis renglones iguales y
 * desplazaba del panel todo lo demás que había pasado. Agrupar sólo lo contiguo
 * es deliberado: si entre dos "Obligación PDTP reportada" hubo otra cosa, el
 * orden cronológico importa y fundirlas lo falsearía.
 *
 * Pura y sin acceso a datos (el tipo se importa sólo como tipo): se prueba sin
 * base ni sesión.
 */
export function groupConsecutiveActivity(entries: readonly OperationalActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (
      last
      && last.actionLabel === entry.actionLabel
      && last.worksiteName === entry.worksiteName
      && last.actorName === entry.actorName
    ) {
      last.count += 1
      last.ids.push(entry.id)
      continue
    }
    groups.push({ ...entry, count: 1, ids: [entry.id] })
  }
  return groups
}
