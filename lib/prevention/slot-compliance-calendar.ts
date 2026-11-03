/**
 * lib/prevention/slot-compliance-calendar.ts
 *
 * El estado de cumplimiento de las casillas del programa anual, por faena y
 * por mes: lo que alimenta el `ComplianceCalendar` de capacitación y de
 * alcotest (CHART-008 de `AUDITORIA_VISUALIZACIONES_CHOME.md`).
 *
 * Es lógica pura, sin base de datos ni React, porque la pregunta «¿este mes
 * está cumplido, vencido o todavía pendiente?» tiene reglas finas que no deben
 * vivir dentro de un componente: la decisión de pintar rojo un mes es la que
 * un fiscalizador va a leer.
 *
 * Reglas, todas heredadas del programa y no inventadas aquí:
 *
 * - **Un mes vence cuando termina.** El mes en curso con casillas sin hacer
 *   sigue «pendiente»; no es deuda todavía. Reusa `pdtpOverdueCutoffMonth`, la
 *   misma regla que el cumplimiento PDTP (un año cerrado vence entero; uno que
 *   no empieza no vence nada).
 * - **«No aplica» sale del denominador.** No cuenta como cumplida ni como
 *   incumplida (`not_applicable`).
 * - **Antes de la activación no se exige.** Una casilla anterior a la semana en
 *   que el programa (o la incorporación de la faena) se hizo exigible no abre
 *   compromiso, pero si se hizo, cuenta como hecha. Mismo corte que
 *   `isPdtpPeriodOnOrAfterActivationPeriod`.
 * - **«No hecha» es una declaración.** Una casilla marcada no hecha es
 *   incumplimiento aunque su mes no haya terminado: alguien ya dijo que no se
 *   hizo.
 */

import { MONTH_LABELS, MONTH_NAMES, countOf, pluralize } from "@/lib/utils"
import {
  isPdtpPeriodOnOrAfterActivationPeriod,
  pdtpOverdueCutoffMonth,
  type PdtpPeriod,
} from "@/lib/services/pdtp/period"

export type SlotCalendarSlotStatus = "pending" | "completed" | "not_completed" | "not_applicable"

/** Misma escala que `ComplianceStatus` del primitivo; se redeclara para que `lib/` no dependa de componentes. */
export type SlotCalendarStatus = "ok" | "partial" | "missing" | "upcoming" | "na"

export type SlotCalendarPhase = "past" | "current" | "future"

/** Una casilla del programa, lo mínimo que hace falta para ubicarla en el calendario. */
export interface SlotCalendarSlot {
  /** La faena (o la fila del calendario) a la que pertenece. */
  rowId: string
  /** 1–12; `null` si la casilla no tiene mes programado. */
  month: number | null
  /** 1–4; `null` si no tiene semana programada. */
  week: number | null
  status: SlotCalendarSlotStatus
  /** Para desglosar el mes cuando mezcla obligaciones distintas («Controles», «Envíos»). */
  group?: string
}

export interface SlotCalendarCell {
  /** 1–12. */
  month: number
  status: SlotCalendarStatus
  phase: SlotCalendarPhase
  /** Casillas que el programa exigía en el mes: hechas + no hechas + pendientes. */
  exigible: number
  completed: number
  /** Declaradas no hechas, más las pendientes cuyo mes ya terminó. */
  missed: number
  /** Texto para el lector de pantalla y el tooltip, además del estado. */
  detail: string
}

export interface SlotCalendarRow {
  id: string
  label: string
  /** Doce celdas, de enero a diciembre. */
  cells: SlotCalendarCell[]
  exigible: number
  completed: number
  missed: number
  /** Meses con al menos una casilla vencida sin cumplir. */
  overdueMonths: number
}

export interface SlotCalendar {
  rows: SlotCalendarRow[]
  /** Casillas exigibles sin mes o sin semana: no caben en una columna. */
  unscheduled: number
}

const MONTHS = 12

/** Pasado / en curso / futuro de un mes del programa de `year`, mirado desde `today`. */
export function monthPhase(year: number, month: number, today: PdtpPeriod): SlotCalendarPhase {
  const overdueThrough = pdtpOverdueCutoffMonth(year, today, today)
  if (month <= overdueThrough) return "past"
  if (year === today.year && month === today.month) return "current"
  return "future"
}

function doneLabel(completed: number, exigible: number): string {
  return `${completed} de ${exigible} ${pluralize(exigible, "hecha", "hechas")}`
}

/**
 * El estado de UN mes de UNA faena a partir de sus casillas.
 *
 * `slots` son las de esa faena y ese mes (cualquier estado); la función decide
 * cuáles se exigían y qué dicen juntas.
 */
export function deriveMonthCell(
  slots: readonly SlotCalendarSlot[],
  context: { year: number; month: number; today: PdtpPeriod; activation: PdtpPeriod | null },
): SlotCalendarCell {
  const { year, month, today, activation } = context
  const phase = monthPhase(year, month, today)

  let completed = 0
  let notCompleted = 0
  let pending = 0
  let notApplicable = 0
  let beforeActivation = 0
  const byGroup = new Map<string, { completed: number; exigible: number }>()

  for (const slot of slots) {
    if (slot.status === "not_applicable") {
      notApplicable += 1
      continue
    }
    // Lo hecho cuenta siempre; lo que falta sólo si el programa ya lo exigía.
    const demanded = slot.status === "completed"
      || !activation
      || slot.week === null
      || isPdtpPeriodOnOrAfterActivationPeriod({ year, month, week: slot.week }, activation)
    if (!demanded) {
      beforeActivation += 1
      continue
    }
    if (slot.status === "completed") completed += 1
    else if (slot.status === "not_completed") notCompleted += 1
    else pending += 1
    if (slot.group) {
      const entry = byGroup.get(slot.group) ?? { completed: 0, exigible: 0 }
      entry.exigible += 1
      if (slot.status === "completed") entry.completed += 1
      byGroup.set(slot.group, entry)
    }
  }

  const exigible = completed + notCompleted + pending
  const missed = notCompleted + (phase === "past" ? pending : 0)

  if (exigible === 0) {
    const detail = beforeActivation > 0
      ? "anterior a la activación del programa"
      : notApplicable > 0 ? "no aplica" : "sin actividad programada"
    return { month, status: "na", phase, exigible: 0, completed: 0, missed: 0, detail }
  }

  const status: SlotCalendarStatus = completed === exigible
    ? "ok"
    : completed > 0
      ? "partial"
      : missed > 0 ? "missing" : "upcoming"

  const base = byGroup.size > 1
    ? [...byGroup.entries()].map(([group, entry]) => `${group} ${entry.completed} de ${entry.exigible}`).join(" · ")
    : doneLabel(completed, exigible)
  const detail = phase === "current" && status !== "ok" ? `${base} · mes en curso` : base

  return { month, status, phase, exigible, completed, missed, detail }
}

/**
 * La grilla faena × mes de un año.
 *
 * - Una faena aparece si tiene al menos una casilla: sin casillas el programa
 *   no está activo para ella y una fila entera de «no exigible» sólo sería
 *   ruido.
 * - `activationByRow` es la activación de CADA faena (el programa y la fecha en
 *   que la faena se incorporó a él): una faena nueva no arrastra el atraso de
 *   los meses en que todavía no existía para el programa.
 */
export function buildSlotCalendar(args: {
  year: number
  today: PdtpPeriod
  rows: ReadonlyArray<{ id: string; label: string }>
  slots: readonly SlotCalendarSlot[]
  activationByRow?: ReadonlyMap<string, PdtpPeriod | null>
}): SlotCalendar {
  const { year, today, rows, slots, activationByRow } = args
  const byRow = new Map<string, SlotCalendarSlot[]>()
  for (const slot of slots) {
    const list = byRow.get(slot.rowId) ?? []
    list.push(slot)
    byRow.set(slot.rowId, list)
  }

  let unscheduled = 0
  const built: SlotCalendarRow[] = []
  for (const row of rows) {
    const own = byRow.get(row.id)
    if (!own || own.length === 0) continue

    const byMonth = new Map<number, SlotCalendarSlot[]>()
    for (const slot of own) {
      const placed = slot.month !== null && slot.week !== null && slot.month >= 1 && slot.month <= MONTHS
      if (!placed) {
        if (slot.status !== "not_applicable") unscheduled += 1
        continue
      }
      const list = byMonth.get(slot.month!) ?? []
      list.push(slot)
      byMonth.set(slot.month!, list)
    }

    const activation = activationByRow?.get(row.id) ?? null
    const cells = Array.from({ length: MONTHS }, (_, index) =>
      deriveMonthCell(byMonth.get(index + 1) ?? [], { year, month: index + 1, today, activation }))
    built.push({
      id: row.id,
      label: row.label,
      cells,
      exigible: cells.reduce((sum, cell) => sum + cell.exigible, 0),
      completed: cells.reduce((sum, cell) => sum + cell.completed, 0),
      missed: cells.reduce((sum, cell) => sum + cell.missed, 0),
      overdueMonths: cells.filter((cell) => cell.missed > 0).length,
    })
  }

  built.sort((left, right) => left.label.localeCompare(right.label, "es-CL"))
  return { rows: built, unscheduled }
}

/**
 * La frase que responde la pregunta del calendario, para `ChartSection.summary`.
 * Cuando varias filas empatan en el mayor atraso no elige una: «la más
 * atrasada» sería un dato inventado.
 */
export function summarizeSlotCalendar(
  rows: readonly SlotCalendarRow[],
  options: { noun: { singular: string; plural: string } },
): string {
  if (rows.length === 0) return ""
  const { noun } = options
  if (rows.every((row) => row.exigible === 0)) return "Todavía no hay actividades exigibles en el programa."

  const late = rows.filter((row) => row.overdueMonths > 0)
  if (late.length === 0) return `Ninguna ${noun.singular} tiene meses vencidos sin cumplir.`

  const worst = Math.max(...late.map((row) => row.overdueMonths))
  const worstRows = late.filter((row) => row.overdueMonths === worst)
  const subject = `${late.length} de ${rows.length} ${noun.plural} ${late.length === 1 ? "tiene" : "tienen"} meses vencidos sin cumplir`
  const tail = worstRows.length === 1
    ? `la más atrasada es ${worstRows[0]!.label} con ${countOf(worst, "mes", "meses")}`
    : `el mayor atraso es de ${countOf(worst, "mes", "meses")} y lo comparten ${worstRows.length} ${noun.plural}`
  return `${subject}; ${tail}.`
}

/** «Ver datos»: lo que el calendario sólo insinúa con un color, en cifras. */
export function slotCalendarDataTable(
  rows: readonly SlotCalendarRow[],
  rowHeader: string,
): { headers: string[]; rows: Array<Array<string | number>> } {
  return {
    headers: [rowHeader, "Actividades exigibles", "Hechas", "Vencidas sin hacer", "Meses con atraso"],
    rows: rows.map((row) => [row.label, row.exigible, row.completed, row.missed, row.overdueMonths]),
  }
}

/** Columnas de enero a diciembre para `ComplianceCalendar`. */
export const SLOT_CALENDAR_COLUMNS: ReadonlyArray<{ key: string; label: string; title: string }> = MONTH_LABELS.map((label, index) => ({
  key: String(index + 1),
  label,
  title: MONTH_NAMES[index]!,
}))

/**
 * El mes (1–12) pedido por `?mes=`. Cualquier otra cosa —vacío, texto, 0, 13,
 * dos valores— es «sin filtro de mes»: una URL manipulada no debe romper la
 * pantalla ni filtrarla a nada.
 */
export function parseCalendarMonth(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== "string" || !/^\d{1,2}$/.test(raw.trim())) return null
  const month = Number(raw.trim())
  return month >= 1 && month <= MONTHS ? month : null
}
