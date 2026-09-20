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
 * simulacro, de CGRD ni de alcotest — invisible hasta que llega una
 * fiscalización.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpPrograms,
  preventionAlcotestSlots,
  preventionEmergencyDrillSlots,
  preventionGrdMeetingSlots,
  preventionProtocolApplicabilities,
} from "@/db/schema"
import {
  ALCOTEST_CONTROL_SLOTS_2026,
  ALCOTEST_DISPATCH_SLOTS_2026,
  DRILL_SLOTS_2026,
  GRD_MEETING_SLOTS_2026,
  PROGRAM_SLOT_YEAR,
  type ProgramSlot,
} from "@/lib/prevention/program-slots-2026"
import { MINSAL_PROTOCOLS } from "@/lib/prevention/minsal-protocols"
import { effectiveActivationFor, pdtpActivationPeriod } from "./pdtp/period"
import { loadWorksiteAddedAt } from "./pdtp/helpers"
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
 * Las casillas de alcotest del año: doce de control (N°30/31) y once de envío
 * (N°32). Devuelve cuántas creó.
 *
 * Las dos series van juntas porque comparten tabla y se distinguen por `kind`,
 * que además forma parte del unique: una casilla de control y una de envío del
 * mismo mes no colisionan.
 */
export async function ensureAlcotestSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year = PROGRAM_SLOT_YEAR,
): Promise<number> {
  const rows = [
    ...slotRows("alcotest-slot", worksiteId, year, ALCOTEST_CONTROL_SLOTS_2026)
      .map((row) => ({ ...row, id: `${row.id}-control`, kind: "control" as const })),
    ...slotRows("alcotest-slot", worksiteId, year, ALCOTEST_DISPATCH_SLOTS_2026)
      .map((row) => ({ ...row, id: `${row.id}-envio`, kind: "envio" as const })),
  ]
  const created = await client.insert(preventionAlcotestSlots)
    .values(rows)
    .onConflictDoNothing({ target: [
      preventionAlcotestSlots.worksiteId,
      preventionAlcotestSlots.year,
      preventionAlcotestSlots.kind,
      preventionAlcotestSlots.slotKey,
    ] })
    .returning({ id: preventionAlcotestSlots.id })
  return created.length
}

/**
 * Los ocho protocolos MINSAL de la faena, sin pronunciar.
 *
 * No son casillas de un cronograma —un protocolo no vence en marzo—, pero les
 * falta exactamente lo mismo: la fila. `getProtocolCoverage` ya devolvía los
 * ocho rellenando en memoria los que no existían, así que la pantalla mostraba
 * "por evaluar" sobre datos que no estaban en la base. Es la misma confusión
 * entre "nadie se pronunció" y "no hay nada que mirar", con una capa de
 * maquillaje que la escondía en la pantalla pero no en los datos: ningún
 * export, ninguna consulta y ningún cálculo veían esos ocho protocolos.
 *
 * El `default` de la columna es `pending_assessment` y nunca llegaba a
 * persistirse por la vía del pronunciamiento, que inserta ya decidido.
 */
export async function ensureProtocolApplicabilitiesForWorksiteTx(
  client: Client,
  worksiteId: string,
): Promise<number> {
  const rows = MINSAL_PROTOCOLS.map((protocol) => ({
    id: `pprot-${worksiteId}-${protocol.code}`,
    protocolCode: protocol.code,
    worksiteId,
    status: "pending_assessment" as const,
    periodicityMonths: protocol.defaultPeriodicityMonths,
    version: 1,
  }))
  const created = await client.insert(preventionProtocolApplicabilities)
    .values(rows)
    .onConflictDoNothing({ target: [
      preventionProtocolApplicabilities.worksiteId,
      preventionProtocolApplicabilities.protocolCode,
    ] })
    .returning({ id: preventionProtocolApplicabilities.id })
  return created.length
}

/**
 * Todas las casillas del programa para una faena, en una llamada.
 *
 * Es lo que deben invocar los puntos de alta de faena. Una faena nueva y
 * activa queda con 24 casillas de capacitación, 2 de simulacro, 4 de CGRD, 23
 * de alcotest (12 controles + 11 envíos) y los 8 protocolos MINSAL sin
 * pronunciar: 61 filas.
 *
 * Se siembra **el año completo**, también para una faena dada de alta en
 * octubre, y eso es deliberado: la casilla de marzo sigue existiendo y se puede
 * cumplir tarde, porque la actividad no se canceló. Lo que no ocurre es el
 * castigo — de eso se encarga el corte de exigibilidad
 * (`effectiveActivationFor`), que saca del denominador y del barrido las
 * casillas anteriores a la incorporación de la faena sin borrarlas ni
 * declararlas no aplicables. Pre-generar sólo desde el mes de alta haría
 * indistinguible "el programa no la exigía" de "nadie la cargó", que es
 * exactamente el problema que este modelo existe para resolver.
 */
export async function ensurePreventionProgramSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
): Promise<{
  training: number
  drills: number
  grdMeetings: number
  alcotest: number
  protocols: number
}> {
  return {
    training: await ensurePreventionTrainingOccurrencesForWorksiteTx(client, worksiteId),
    drills: await ensureEmergencyDrillSlotsForWorksiteTx(client, worksiteId),
    grdMeetings: await ensureGrdMeetingSlotsForWorksiteTx(client, worksiteId),
    alcotest: await ensureAlcotestSlotsForWorksiteTx(client, worksiteId),
    protocols: await ensureProtocolApplicabilitiesForWorksiteTx(client, worksiteId),
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

/** Las casillas de alcotest de una faena y año, para la pantalla. */
export async function listAlcotestSlots(client: Client, worksiteId: string, year = PROGRAM_SLOT_YEAR) {
  return client.select().from(preventionAlcotestSlots).where(and(
    eq(preventionAlcotestSlots.worksiteId, worksiteId),
    eq(preventionAlcotestSlots.year, year),
  ))
}

/**
 * La semana desde la que el programa vigente le exige a esta faena, o `null` si
 * no hay programa activo del año.
 *
 * Existe para que el checklist pueda distinguir una casilla que nadie hizo de
 * una que el programa todavía no exigía cuando llegó su mes. No cambia el
 * estado de la casilla —sigue pendiente y se puede hacer tarde—: sólo permite
 * decirlo en pantalla, para que nadie corra a ejecutar algo que no se le pedía.
 *
 * Con `worksiteId` el corte incluye la fecha en que la faena entró al programa,
 * que es la misma regla que aplican el cálculo de cumplimiento y el barrido. Sin
 * él devuelve el corte del programa, que es lo que corresponde cuando no hay una
 * faena de la cual hablar.
 */
export async function resolveProgramActivationPeriod(worksiteId?: string, year = PROGRAM_SLOT_YEAR) {
  const [program] = await db.select({ id: pdtpPrograms.id, activatedAt: pdtpPrograms.activatedAt })
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  if (!program) return pdtpActivationPeriod(null)
  const cutoff = worksiteId
    ? effectiveActivationFor(program.activatedAt, await loadWorksiteAddedAt(program.id, worksiteId))
    : program.activatedAt
  return pdtpActivationPeriod(cutoff ?? null)
}
