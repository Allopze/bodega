/**
 * La evaluación cuantitativa N°45 por faena, en una lista corta.
 *
 * La actividad N°45 del programa anual es UNA casilla por faena y año (febrero,
 * semana 2): en un calendario faena × mes quedaba una celda exigible de doce por
 * fila. La pregunta real —«¿qué faenas la tienen hecha y cuáles no?»— se contesta
 * con una fila por faena, su estado y, si está hecha, la fecha de la medición.
 *
 * Lógica pura, sin React: el orden y el denominador son decisiones de lectura.
 */

export type N45Status = "completed" | "pending" | "not_completed" | "not_applicable" | "none"

/** Lo mínimo de una casilla N°45 (la que ya arma la página) para ubicarla en una faena. */
export interface N45SlotInput {
  worksiteId: string
  status: "pending" | "completed" | "not_completed" | "not_applicable"
  scheduledMonth: number
  /** Fecha de calendario de la medición que la cumplió (`YYYY-MM-DD`); `null` si no está hecha. */
  measuredOn: string | null
  /** Código del GES de esa medición. */
  groupCode: string | null
}

export interface N45Row {
  worksiteId: string
  worksiteName: string
  status: N45Status
  /** Mes (1–12) en que el programa espera la casilla; `null` si la faena no la tiene. */
  scheduledMonth: number | null
  measuredOn: string | null
  groupCode: string | null
}

export interface N45Model {
  rows: N45Row[]
  /** Faenas con la evaluación hecha. */
  done: number
  /** Faenas donde el programa la exige: «no aplica» y «sin casilla» salen del denominador. */
  due: number
}

/** Lo que falta primero: es lo accionable. Lo que no aplica o no tiene casilla, al final. */
const ORDER: Record<N45Status, number> = { not_completed: 0, pending: 1, completed: 2, not_applicable: 3, none: 4 }

/** Una faena con más de una casilla (no ocurre hoy) se lee por la mejor: la hecha gana. */
const PICK: Record<N45SlotInput["status"], number> = { completed: 0, pending: 1, not_completed: 2, not_applicable: 3 }

export function shapeN45Status(worksites: readonly { id: string; name: string }[], slots: readonly N45SlotInput[]): N45Model {
  const byWorksite = new Map<string, N45SlotInput>()
  for (const slot of slots) {
    const current = byWorksite.get(slot.worksiteId)
    if (!current || PICK[slot.status] < PICK[current.status]) byWorksite.set(slot.worksiteId, slot)
  }

  const rows: N45Row[] = worksites.map((worksite) => {
    const slot = byWorksite.get(worksite.id)
    return slot
      ? {
        worksiteId: worksite.id, worksiteName: worksite.name, status: slot.status,
        scheduledMonth: slot.scheduledMonth, measuredOn: slot.measuredOn, groupCode: slot.groupCode,
      }
      : { worksiteId: worksite.id, worksiteName: worksite.name, status: "none", scheduledMonth: null, measuredOn: null, groupCode: null }
  })
  rows.sort((left, right) => ORDER[left.status] - ORDER[right.status] || left.worksiteName.localeCompare(right.worksiteName, "es-CL"))

  const done = rows.filter((row) => row.status === "completed").length
  const due = rows.filter((row) => row.status !== "not_applicable" && row.status !== "none").length
  return { rows, done, due }
}
