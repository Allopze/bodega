import type { MiperHistoryEvent } from "@/lib/services/miper/queries"

export type HistoryGroup = { first: MiperHistoryEvent; count: number; ids: string[] }

/** Minuto del evento según el ISO (no el texto localizado: dos locales distintos no deben partir un grupo). */
const minuteOf = (at: string) => at.slice(0, 16)

const sameRun = (a: MiperHistoryEvent, b: MiperHistoryEvent) =>
  a.changeType === b.changeType && a.object === b.object && a.actorName === b.actorName && a.actingAs === b.actingAs && minuteOf(a.at) === minuteOf(b.at)

/**
 * Colapsa eventos CONSECUTIVOS idénticos (mismo tipo, objeto, actor, rol y minuto). El
 * importador del RE-04 escribe un `import_applied` por fila: sin agrupar, 230 líneas
 * iguales entierran el resto de la bitácora. Un evento con motivo nunca se agrupa: el
 * motivo es lo que lo distingue y esconderlo perdería información.
 */
export function groupHistoryEvents(events: readonly MiperHistoryEvent[]): HistoryGroup[] {
  const groups: HistoryGroup[] = []
  for (const event of events) {
    const last = groups[groups.length - 1]
    if (last && !event.reason && !last.first.reason && sameRun(last.first, event)) {
      last.count += 1
      last.ids.push(event.id)
    } else groups.push({ first: event, count: 1, ids: [event.id] })
  }
  return groups
}
