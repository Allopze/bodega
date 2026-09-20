/**
 * lib/services/prevention-program-slots.ts
 *
 * Pre-generación de las casillas del programa para una faena.
 *
 * Es un agregador de puntos de llamada, no una abstracción de dominio: cada
 * módulo conserva su tabla, su servicio y sus tests. Existe porque hoy el alta
 * de una faena ocurre en tres lugares distintos, y con tres módulos serían
 * nueve llamadas: el modo de falla es que alguien agregue un cuarto punto de
 * alta y pre-genere sólo capacitación, dejando una faena sin casillas de
 * simulacro ni de CGRD — invisible hasta que llega una fiscalización.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpPrograms,
  preventionEmergencyDrillSlots,
  preventionGrdMeetingSlots,
} from "@/db/schema"
import {
  DRILL_SLOTS_2026,
  GRD_MEETING_SLOTS_2026,
  PROGRAM_SLOT_YEAR,
  type ProgramSlot,
} from "@/lib/prevention/program-slots-2026"
import { pdtpActivationPeriod } from "./pdtp/period"
import { ensurePreventionTrainingOccurrencesForWorksiteTx } from "./prevention-training-occurrences"

type Client = DB | Tx

/* Los identificadores son determinísticos —no `nanoid()`— para que el
 * `onConflictDoNothing` sobre el unique de slot sea idempotente de verdad:
 * reejecutar no crea filas nuevas ni pisa el estado de las existentes. */
function slotRows(prefix: string, worksiteId: string, year: number, slots: readonly ProgramSlot[]) {
  return slots.map((slot) => ({
    id: `${prefix}-${year}-${worksiteId}-${slot.slotKey}`,
    worksiteId,
    year,
    slotKey: slot.slotKey,
    scheduledMonth: slot.month,
    scheduledWeek: slot.week,
    status: "pending" as const,
    version: 1,
  }))
}

/** Las dos casillas de simulacro del año (N°84). Devuelve cuántas creó. */
export async function ensureEmergencyDrillSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year = PROGRAM_SLOT_YEAR,
): Promise<number> {
  const rows = slotRows("drill-slot", worksiteId, year, DRILL_SLOTS_2026)
  const created = await client.insert(preventionEmergencyDrillSlots)
    .values(rows)
    .onConflictDoNothing({ target: [
      preventionEmergencyDrillSlots.worksiteId,
      preventionEmergencyDrillSlots.year,
      preventionEmergencyDrillSlots.slotKey,
    ] })
    .returning({ id: preventionEmergencyDrillSlots.id })
  return created.length
}

/** Las cuatro casillas de acta del CGRD del año (N°81). Devuelve cuántas creó. */
export async function ensureGrdMeetingSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year = PROGRAM_SLOT_YEAR,
): Promise<number> {
  const rows = slotRows("grd-slot", worksiteId, year, GRD_MEETING_SLOTS_2026)
  const created = await client.insert(preventionGrdMeetingSlots)
    .values(rows)
    .onConflictDoNothing({ target: [
      preventionGrdMeetingSlots.worksiteId,
      preventionGrdMeetingSlots.year,
      preventionGrdMeetingSlots.slotKey,
    ] })
    .returning({ id: preventionGrdMeetingSlots.id })
  return created.length
}

/**
 * Todas las casillas del programa para una faena, en una llamada.
 *
 * Es lo que deben invocar los puntos de alta de faena. Una faena nueva y
 * activa queda con 24 casillas de capacitación, 2 de simulacro y 4 de CGRD.
 */
export async function ensurePreventionProgramSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
): Promise<{ training: number; drills: number; grdMeetings: number }> {
  return {
    training: await ensurePreventionTrainingOccurrencesForWorksiteTx(client, worksiteId),
    drills: await ensureEmergencyDrillSlotsForWorksiteTx(client, worksiteId),
    grdMeetings: await ensureGrdMeetingSlotsForWorksiteTx(client, worksiteId),
  }
}

/** Las casillas de simulacro de una faena y año, para la pantalla. */
export async function listEmergencyDrillSlots(client: Client, worksiteIds: string[], year = PROGRAM_SLOT_YEAR) {
  if (worksiteIds.length === 0) return []
  return client.select().from(preventionEmergencyDrillSlots).where(and(
    inArray(preventionEmergencyDrillSlots.worksiteId, worksiteIds),
    eq(preventionEmergencyDrillSlots.year, year),
  ))
}

/** Las casillas de acta del CGRD de una faena y año, para la pantalla. */
export async function listGrdMeetingSlots(client: Client, worksiteId: string, year = PROGRAM_SLOT_YEAR) {
  return client.select().from(preventionGrdMeetingSlots).where(and(
    eq(preventionGrdMeetingSlots.worksiteId, worksiteId),
    eq(preventionGrdMeetingSlots.year, year),
  ))
}

/**
 * La semana desde la que el programa vigente exige, o `null` si no hay programa
 * activo del año.
 *
 * Existe para que el checklist pueda distinguir una casilla que nadie hizo de
 * una que el programa todavía no exigía cuando llegó su mes. No cambia el
 * estado de la casilla —sigue pendiente y se puede hacer tarde—: sólo permite
 * decirlo en pantalla, para que nadie corra a ejecutar algo que no se le pedía.
 */
export async function resolveProgramActivationPeriod(year = PROGRAM_SLOT_YEAR) {
  const [program] = await db.select({ activatedAt: pdtpPrograms.activatedAt })
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  return pdtpActivationPeriod(program?.activatedAt ?? null)
}
