/**
 * lib/prevention/committee-session-calendar.ts
 *
 * El calendario de sesiones del Comité Paritario: comité × mes, «sesionó» o «no
 * sesionó» (CHART-008 de `AUDITORIA_VISUALIZACIONES_CHOME.md`, pantalla de CPHS).
 *
 * La pantalla muestra «Sin sesionar: N» como una cifra, que dice que hay atraso
 * pero no en qué meses ni desde cuándo. La regla de fondo es la que ya aplica
 * `assessMeetingCadence`: el comité sesiona al menos una vez al mes, y sólo cuenta
 * una sesión con el acta cerrada (que exige quórum). Este módulo no inventa otra:
 *
 * - **Exigible desde el mes de constitución.** Un comité sin ninguna sesión ya es
 *   «atrasado» para `assessMeetingCadence`, sin gracia por el mes de constitución;
 *   acá un mes sólo vence cuando termina, igual que en los demás calendarios.
 * - **Hasta el mes anterior a su disolución.** Un comité disuelto no debe las
 *   sesiones posteriores. Un mandato vencido NO corta la exigibilidad: lo que el
 *   comité deja de ser es válido, no dispensado, y la lista ya lo avisa aparte.
 * - **Una sesión por mes alcanza.** Dos sesiones en un mes (una extraordinaria) no
 *   cuentan doble: el calendario mide el piso legal, no la actividad.
 * - **Cerrada es realizada.** Una sesión convocada y no cerrada no cuenta como
 *   realizada, aunque su fecha ya haya pasado.
 *
 * Lógica pura, sin base de datos ni React.
 */

import { chileDateParts } from "@/lib/utils"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import { buildSlotCalendar, type SlotCalendar, type SlotCalendarSlot, type SlotCalendarWording } from "./slot-compliance-calendar"

export const SESSION_CALENDAR_WORDING: SlotCalendarWording = {
  unit: { singular: "sesión", plural: "sesiones" },
  done: { singular: "realizada", plural: "realizadas" },
  overdue: { singular: "vencida", plural: "vencidas" },
  noneDue: "Todavía no hay sesiones exigibles: los comités se constituyeron después de este año.",
  naEmpty: "sin sesión exigible",
  naBeforeActivation: "anterior a la constitución del comité",
}

/** «Sesionó» y «no sesionó» en vez de «cumplido» y «vencido sin cumplir». */
export const SESSION_STATUS_LABELS = {
  ok: "Sesionó",
  missing: "Sin sesionar (vencido)",
  upcoming: "Por sesionar",
  na: "No exigible",
} as const

/** Una sesión es todo o nada por mes: no hay «parcial». */
export const SESSION_LEGEND = ["ok", "missing", "upcoming", "na"] as const

export interface SessionCalendarCommittee {
  id: string
  label: string
  /** `YYYY-MM-DD`. */
  constitutedOn: string
  /** Instante de la disolución, si se disolvió. */
  dissolvedAt: string | null
}

/** Entre qué meses (1–12) se le exige sesión a un comité en `year`. */
export function sessionExigibleRange(committee: Pick<SessionCalendarCommittee, "constitutedOn" | "dissolvedAt">, year: number): { firstMonth: number; lastMonth: number } {
  const constitutedYear = Number(committee.constitutedOn.slice(0, 4))
  const constitutedMonth = Number(committee.constitutedOn.slice(5, 7))
  const firstMonth = constitutedYear < year ? 1 : constitutedYear > year ? 13 : constitutedMonth
  const dissolved = committee.dissolvedAt ? chileDateParts(committee.dissolvedAt) : null
  const lastMonth = !dissolved || dissolved.year > year ? 12 : dissolved.year < year ? 0 : dissolved.month - 1
  return { firstMonth, lastMonth }
}

export function buildSessionCalendar(args: {
  year: number
  today: PdtpPeriod
  committees: readonly SessionCalendarCommittee[]
  /** Meses (1–12) con al menos una sesión de acta cerrada, por comité. */
  heldMonths: ReadonlyMap<string, ReadonlySet<number>>
}): SlotCalendar {
  const { year, today, committees, heldMonths } = args
  const slots: SlotCalendarSlot[] = []
  for (const committee of committees) {
    const held = heldMonths.get(committee.id) ?? new Set<number>()
    const { firstMonth, lastMonth } = sessionExigibleRange(committee, year)
    for (let month = 1; month <= 12; month++) {
      const exigible = month >= firstMonth && month <= lastMonth
      // Una sesión realizada fuera del rango exigible se ve como realizada, no se esconde.
      if (!exigible && !held.has(month)) continue
      slots.push({ rowId: committee.id, month, week: 4, status: held.has(month) ? "completed" : "pending" })
    }
  }
  return buildSlotCalendar({
    year,
    today,
    rows: committees.map((committee) => ({ id: committee.id, label: committee.label })),
    slots,
    wording: SESSION_CALENDAR_WORDING,
  })
}
