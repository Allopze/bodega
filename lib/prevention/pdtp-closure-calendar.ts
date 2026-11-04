/**
 * lib/prevention/pdtp-closure-calendar.ts
 *
 * El calendario de cierres mensuales del PDTP: faena × mes, «cerrado» o «sin
 * cerrar» (CHART-008 de `AUDITORIA_VISUALIZACIONES_CHOME.md`, pantalla de cierres).
 *
 * La pantalla de cierres sólo lista los meses que SE cerraron. El dato que pide
 * el cierre anual —qué faena debe qué mes— está en lo que NO aparece, y una
 * lista no muestra lo que falta. Esta regla es la del cierre anual
 * (`lib/services/pdtp/year-close.ts`), no una propia: un calendario que dijera
 * «al día» donde el cierre del año dice «faltan meses» sería peor que no tenerlo.
 *
 * - **Exigible desde la activación.** Un mes se debe desde el mes en que el
 *   programa se activó o la faena se incorporó, lo que ocurra después. Activado
 *   antes del año (un programa importado), se debe el año completo. Un programa
 *   que no se ha activado no le exige nada a nadie.
 * - **Hasta la baja.** Una faena dada de baja debe los meses completos anteriores
 *   a su baja.
 * - **Cerrado vale cualquiera.** El cierre de cualquier versión del año cuenta
 *   (una v2 no borra los cierres de la v1); lo decide quien arma `closedMonths`.
 * - **Un mes vence cuando termina.** El mes en curso sin cerrar es «por cerrar»,
 *   no deuda. Eso lo resuelve `buildSlotCalendar`.
 * - **Reabierto no es cerrado.** Un cierre reabierto vuelve a ser un mes por cerrar.
 *
 * Lógica pura, sin base de datos ni React.
 */

import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import { buildSlotCalendar, type SlotCalendar, type SlotCalendarSlot, type SlotCalendarWording } from "./slot-compliance-calendar"

export const CLOSURE_CALENDAR_WORDING: SlotCalendarWording = {
  unit: { singular: "cierre", plural: "cierres" },
  done: { singular: "hecho", plural: "hechos" },
  overdue: { singular: "vencido", plural: "vencidos" },
  noneDue: "Todavía no hay cierres mensuales exigibles: el programa no se ha activado o aún no llega su primer mes.",
  naEmpty: "sin cierre exigible",
  naBeforeActivation: "anterior a la activación del programa",
}

/** «Cerrado» y «sin cerrar» en vez de «cumplido» y «vencido sin cumplir». */
export const CLOSURE_STATUS_LABELS = {
  ok: "Cerrado",
  missing: "Sin cerrar (vencido)",
  upcoming: "Por cerrar",
  na: "No exigible",
} as const

/** Un cierre es todo o nada: no hay «parcial» que explicar en la leyenda. */
export const CLOSURE_LEGEND = ["ok", "missing", "upcoming", "na"] as const

/**
 * Entre qué meses (1–12) se le exige cierre a una faena en el año del programa.
 * `firstMonth` 13 o `lastMonth` 0 significan «ninguno».
 */
export function closureExigibleRange(args: {
  year: number
  /** Cuándo empezó a exigírsele (programa activado o faena incorporada); `null` si el programa no se activó. */
  activation: PdtpPeriod | null
  /** Cuándo se dio de baja la faena, si se dio. */
  deactivated: { year: number; month: number } | null
}): { firstMonth: number; lastMonth: number } {
  const { year, activation, deactivated } = args
  // Sin activación no se exige nada. (El cierre anual trata ese caso como el año completo porque
  // sólo lo evalúa con un programa activo; acá la pantalla también se abre sobre borradores.)
  const firstMonth = !activation ? 13 : activation.year < year ? 1 : activation.year > year ? 13 : activation.month
  const lastMonth = !deactivated || deactivated.year > year ? 12 : deactivated.year < year ? 0 : deactivated.month - 1
  return { firstMonth, lastMonth }
}

export interface ClosureCalendarWorksite {
  id: string
  label: string
  firstMonth: number
  lastMonth: number
}

/**
 * El calendario: una casilla por faena y mes exigible (hecha si hay un cierre
 * vigente), más una casilla hecha por cada cierre fuera del rango exigible (se
 * cerró aunque no se exigiera, y eso se ve).
 */
export function buildClosureCalendar(args: {
  year: number
  today: PdtpPeriod
  worksites: readonly ClosureCalendarWorksite[]
  /** Meses con cierre vigente (`closed`, no `reopened`), por faena. */
  closedMonths: ReadonlyMap<string, ReadonlySet<number>>
}): SlotCalendar {
  const { year, today, worksites, closedMonths } = args
  const slots: SlotCalendarSlot[] = []
  for (const worksite of worksites) {
    const closed = closedMonths.get(worksite.id) ?? new Set<number>()
    for (let month = 1; month <= 12; month++) {
      const exigible = month >= worksite.firstMonth && month <= worksite.lastMonth
      if (!exigible && !closed.has(month)) continue
      // Semana 4: el mes se debe entero, no desde una semana en particular.
      slots.push({ rowId: worksite.id, month, week: 4, status: closed.has(month) ? "completed" : "pending" })
    }
  }
  return buildSlotCalendar({
    year,
    today,
    rows: worksites.map((worksite) => ({ id: worksite.id, label: worksite.label })),
    slots,
    wording: CLOSURE_CALENDAR_WORDING,
  })
}
