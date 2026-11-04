/**
 * lib/services/prevention-program-calendar.ts
 *
 * El calendario de cumplimiento (CHART-008) de los programas anuales de casillas
 * que viven por faena: simulacros (N°84), actas del CGRD (N°81) y la evaluación
 * cuantitativa de higiene (N°45). Capacitación y alcotest ya tienen su propio
 * lector; éstos tres comparten la forma —una casilla por faena, mes y semana, con
 * estado— así que comparten el lector.
 *
 * Es un servicio de LECTURA: arma el calendario, no toca las casillas. Las casillas
 * las siembra `prevention-program-slots.ts` y las resuelve cada módulo.
 */

import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionEmergencyDrillSlots,
  preventionEmergencyPlans,
  preventionGrdMeetingSlots,
  preventionHygieneMeasurementSlots,
  worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { buildSlotCalendar, type SlotCalendar, type SlotCalendarSlotStatus } from "@/lib/prevention/slot-compliance-calendar"
import { currentPdtpPeriod, type PdtpPeriod } from "@/lib/services/pdtp/period"
import { resolveProgramActivationPeriods } from "./prevention-program-slots"

export type ProgramCalendarKind = "drills" | "grd" | "hygiene"

/**
 * Las tres tablas de casillas tienen las mismas columnas de ubicación y estado
 * (`worksite_id`, `year`, `scheduled_month`, `scheduled_week`, `status`); por eso
 * una sola consulta las sirve a las tres. El tipo de la de simulacros representa
 * a las demás: sólo se leen esas columnas.
 */
const SLOT_TABLES: Record<ProgramCalendarKind, typeof preventionEmergencyDrillSlots> = {
  drills: preventionEmergencyDrillSlots,
  grd: preventionGrdMeetingSlots as unknown as typeof preventionEmergencyDrillSlots,
  hygiene: preventionHygieneMeasurementSlots as unknown as typeof preventionEmergencyDrillSlots,
}

export interface ProgramCalendarSlot {
  worksiteId: string
  worksiteName: string
  scheduledMonth: number
  scheduledWeek: number
  status: SlotCalendarSlotStatus
}

/**
 * Las casillas del año en las faenas ACTIVAS del alcance, con el nombre de la
 * faena. Sin evidencia ni observaciones: el calendario sólo necesita ubicar y
 * clasificar. Un alcance vacío son cero filas, nunca «sin filtro».
 */
export async function listProgramSlotsForCalendar(
  kind: ProgramCalendarKind,
  scope: string[] | "all",
  year: number,
): Promise<ProgramCalendarSlot[]> {
  const table = SLOT_TABLES[kind]
  const rows = await db.select({
    worksiteId: table.worksiteId,
    worksiteName: worksites.name,
    scheduledMonth: table.scheduledMonth,
    scheduledWeek: table.scheduledWeek,
    status: table.status,
  })
    .from(table)
    .innerJoin(worksites, eq(table.worksiteId, worksites.id))
    .where(and(
      eq(table.year, year),
      eq(worksites.isActive, true),
      worksiteScopeSqlFor(scope, table.worksiteId),
    ))
  return rows.map((row) => ({ ...row, status: row.status as SlotCalendarSlotStatus }))
}

/**
 * El calendario faena × mes de un programa de casillas: las casillas del
 * alcance, la activación de CADA faena (una faena que entró tarde no arrastra el
 * atraso de los meses en que el programa no la exigía) y la grilla armada.
 * `today` sólo se pasa en las pruebas.
 */
export async function loadProgramSlotCalendar(
  kind: ProgramCalendarKind,
  scope: string[] | "all",
  year: number,
  today: PdtpPeriod = currentPdtpPeriod(),
): Promise<SlotCalendar> {
  const slots = await listProgramSlotsForCalendar(kind, scope, year)
  const rows = [...new Map(slots.map((slot) => [slot.worksiteId, { id: slot.worksiteId, label: slot.worksiteName }])).values()]
  return buildSlotCalendar({
    year,
    today,
    rows,
    slots: slots.map((slot) => ({
      rowId: slot.worksiteId,
      month: slot.scheduledMonth,
      week: slot.scheduledWeek,
      status: slot.status,
    })),
    activationByRow: await resolveProgramActivationPeriods(rows.map((row) => row.id), year),
  })
}

/**
 * El plan de emergencia vigente de cada faena del alcance (el que no está
 * archivado; la base garantiza uno solo por faena). Es a dónde lleva un mes del
 * calendario de simulacros: ahí se registra el simulacro y se resuelve la casilla.
 */
export async function listCurrentEmergencyPlanIds(scope: string[] | "all"): Promise<Map<string, string>> {
  const rows = await db.select({ id: preventionEmergencyPlans.id, worksiteId: preventionEmergencyPlans.worksiteId })
    .from(preventionEmergencyPlans)
    .where(and(
      ne(preventionEmergencyPlans.status, "archived"),
      worksiteScopeSqlFor(scope, preventionEmergencyPlans.worksiteId),
    ))
  return new Map(rows.map((row) => [row.worksiteId, row.id]))
}
