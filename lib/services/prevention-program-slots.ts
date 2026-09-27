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
 *
 * PREV-C03.4 (D22): las casillas son POR AÑO. El cronograma 2026 sigue
 * congelado en `program-slots-2026.ts` (su test lo compara celda a celda con el
 * catálogo); desde 2027 se deriva de la planificación del programa activo de
 * ese año, así que reprogramar el simulacro en el programa mueve la casilla.
 * Sin programa activo del año no se siembra nada para ese año (conducta
 * explícita, no silenciosa): hasta que el programa 2027 se active no hay
 * casillas 2027.
 *
 * **Una sola regla para sembrar** (la usan los tres puntos de alta de faena, el
 * backfill y la activación de un programa): una faena recibe las casillas de
 * cada año cuyo programa activo la incluye (miembro activo, o alcance
 * corporativo). Mientras no exista ningún programa activo —el arranque de la
 * plataforma y los fixtures— se siembra el año base 2026, que era el único
 * comportamiento anterior.
 */

import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, notExists, notInArray, or, type AnyColumn, type SQL } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpPrograms,
  preventionAlcotestSlotEvidence,
  preventionAlcotestSlots,
  preventionEmergencyDrillSlots,
  preventionGrdMeetingSlots,
  preventionHygieneMeasurementSlots,
  preventionProtocolApplicabilities,
} from "@/db/schema"
import {
  ALCOTEST_CONTROL_PDTP_ACTIVITY_NUMBERS,
  ALCOTEST_CONTROL_SLOTS_2026,
  ALCOTEST_DISPATCH_PDTP_ACTIVITY_NUMBER,
  ALCOTEST_DISPATCH_SLOTS_2026,
  DRILL_PDTP_ACTIVITY_NUMBER,
  DRILL_SLOTS_2026,
  GRD_MEETING_PDTP_ACTIVITY_NUMBER,
  GRD_MEETING_SLOTS_2026,
  HYGIENE_MEASUREMENT_PDTP_ACTIVITY_NUMBER,
  HYGIENE_MEASUREMENT_SLOTS_2026,
  PROGRAM_SLOT_BASE_YEAR,
  type ProgramSlot,
} from "@/lib/prevention/program-slots-2026"
import { isTrainingCatalogYear } from "@/lib/prevention/training-occurrences-catalog"
import { MINSAL_PROTOCOLS } from "@/lib/prevention/minsal-protocols"
import { effectiveActivationFor, pdtpActivationPeriod, type PdtpPeriod } from "./pdtp/period"
import { loadWorksiteAddedAt } from "./pdtp/helpers"
import { listPdtpProgramOperatingWorksiteIds } from "./pdtp/worksites"
import { legacyPdtpActivityNumberForCatalogId } from "./pdtp-adapters/catalog-activities-2026"
import { ensurePreventionTrainingOccurrencesForWorksiteTx } from "./prevention-training-occurrences"

type Client = DB | Tx

/** El cronograma de casillas de un año, por familia. */
export type ProgramSlotSchedules = {
  drills: readonly ProgramSlot[]
  grdMeetings: readonly ProgramSlot[]
  hygieneMeasurements: readonly ProgramSlot[]
  alcotestControl: readonly ProgramSlot[]
  alcotestDispatch: readonly ProgramSlot[]
}

const BASE_YEAR_SCHEDULES: ProgramSlotSchedules = {
  drills: DRILL_SLOTS_2026,
  grdMeetings: GRD_MEETING_SLOTS_2026,
  hygieneMeasurements: HYGIENE_MEASUREMENT_SLOTS_2026,
  alcotestControl: ALCOTEST_CONTROL_SLOTS_2026,
  alcotestDispatch: ALCOTEST_DISPATCH_SLOTS_2026,
}

function slotFor(month: number, week: number): ProgramSlot {
  return { slotKey: `m${String(month).padStart(2, "0")}-w${week}`, month, week }
}

async function activeProgramOfYear(client: Client, year: number) {
  const [program] = await client.select({ id: pdtpPrograms.id, activatedAt: pdtpPrograms.activatedAt })
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  return program ?? null
}

/**
 * El cronograma de casillas del año. 2026 usa el cronograma congelado; otro año
 * lo lee de la planificación del programa activo, buscando cada actividad por
 * su identidad de catálogo (con caída al número). `null` si el año no tiene
 * programa activo: no se inventa un cronograma copiando el de 2026.
 */
export async function resolveProgramSlotSchedules(client: Client, year: number): Promise<ProgramSlotSchedules | null> {
  if (year === PROGRAM_SLOT_BASE_YEAR) return BASE_YEAR_SCHEDULES
  const program = await activeProgramOfYear(client, year)
  if (!program) return null
  const wanted = [
    DRILL_PDTP_ACTIVITY_NUMBER,
    GRD_MEETING_PDTP_ACTIVITY_NUMBER,
    HYGIENE_MEASUREMENT_PDTP_ACTIVITY_NUMBER,
    ...ALCOTEST_CONTROL_PDTP_ACTIVITY_NUMBERS,
    ALCOTEST_DISPATCH_PDTP_ACTIVITY_NUMBER,
  ]
  const activities = await client.select({ id: pdtpActivities.id, n: pdtpActivities.n, catalogActivityId: pdtpActivities.catalogActivityId })
    .from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, program.id), eq(pdtpActivities.status, "active")))
  // La identidad de catálogo manda sobre el número: un programa renumerado
  // sigue encontrando el simulacro aunque ya no sea la N°84.
  const activityIdByLegacyNumber = new Map<number, string>()
  for (const activity of activities) {
    const legacy = activity.catalogActivityId ? legacyPdtpActivityNumberForCatalogId(activity.catalogActivityId) : null
    if (legacy !== null && wanted.includes(legacy)) activityIdByLegacyNumber.set(legacy, activity.id)
  }
  for (const activity of activities) {
    if (wanted.includes(activity.n) && !activityIdByLegacyNumber.has(activity.n)) activityIdByLegacyNumber.set(activity.n, activity.id)
  }
  const activityIds = [...new Set(activityIdByLegacyNumber.values())]
  const cells = activityIds.length === 0 ? [] : await client.select({
    activityId: pdtpActivitySchedule.activityId,
    month: pdtpActivitySchedule.month,
    week: pdtpActivitySchedule.week,
    plannedQuantity: pdtpActivitySchedule.plannedQuantity,
  }).from(pdtpActivitySchedule)
    .where(and(inArray(pdtpActivitySchedule.activityId, activityIds), eq(pdtpActivitySchedule.year, year)))
  const slotsOf = (legacyNumber: number): ProgramSlot[] => {
    const activityId = activityIdByLegacyNumber.get(legacyNumber)
    if (!activityId) return []
    const seen = new Set<string>()
    return cells
      .filter((cell) => cell.activityId === activityId && cell.plannedQuantity > 0)
      .sort((left, right) => left.month - right.month || left.week - right.week)
      .map((cell) => slotFor(cell.month, cell.week))
      .filter((slot) => !seen.has(slot.slotKey) && Boolean(seen.add(slot.slotKey)))
  }
  const [primaryControl, secondaryControl] = ALCOTEST_CONTROL_PDTP_ACTIVITY_NUMBERS
  const control = slotsOf(primaryControl)
  return {
    drills: slotsOf(DRILL_PDTP_ACTIVITY_NUMBER),
    grdMeetings: slotsOf(GRD_MEETING_PDTP_ACTIVITY_NUMBER),
    hygieneMeasurements: slotsOf(HYGIENE_MEASUREMENT_PDTP_ACTIVITY_NUMBER),
    // N°30 y N°31 comparten una sola serie de celdas.
    alcotestControl: control.length > 0 ? control : slotsOf(secondaryControl),
    alcotestDispatch: slotsOf(ALCOTEST_DISPATCH_PDTP_ACTIVITY_NUMBER),
  }
}

/**
 * La regla única: los años cuyas casillas le corresponden a la faena. Ver la
 * cabecera del archivo.
 */
export async function resolveProgramSlotYearsForWorksite(client: Client, worksiteId: string): Promise<number[]> {
  const activePrograms = await client.select({ id: pdtpPrograms.id, year: pdtpPrograms.year })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.status, "active"))
  // Sin ningún programa activo se siembra el año base, que es el arranque de la
  // plataforma y de los fixtures. Pero no si ese año ya se cerró formalmente
  // (T6): en enero, entre el cierre del año anterior y la activación del
  // nuevo, una faena nueva recibía casillas de un año que nadie puede cumplir.
  if (activePrograms.length === 0) {
    const [closedBase] = await client.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
      .where(and(eq(pdtpPrograms.year, PROGRAM_SLOT_BASE_YEAR), isNotNull(pdtpPrograms.yearClosedAt)))
      .limit(1)
    return closedBase ? [] : [PROGRAM_SLOT_BASE_YEAR]
  }
  const years = new Set<number>()
  for (const program of activePrograms) {
    const operating = await listPdtpProgramOperatingWorksiteIds(program.id, client)
    if (operating.includes(worksiteId)) years.add(program.year)
  }
  return [...years].sort((left, right) => left - right)
}

async function schedulesOrNull(client: Client, year: number, schedules?: ProgramSlotSchedules | null) {
  return schedules === undefined ? resolveProgramSlotSchedules(client, year) : schedules
}

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

/** Las casillas de simulacro del año (N°84). Devuelve cuántas creó. */
export async function ensureEmergencyDrillSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year: number,
  schedules?: ProgramSlotSchedules | null,
): Promise<number> {
  const resolved = await schedulesOrNull(client, year, schedules)
  const rows = slotRows("drill-slot", worksiteId, year, resolved?.drills ?? [])
  if (rows.length === 0) return 0
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

/** Las casillas de acta del CGRD del año (N°81). Devuelve cuántas creó. */
export async function ensureGrdMeetingSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year: number,
  schedules?: ProgramSlotSchedules | null,
): Promise<number> {
  const resolved = await schedulesOrNull(client, year, schedules)
  const rows = slotRows("grd-slot", worksiteId, year, resolved?.grdMeetings ?? [])
  if (rows.length === 0) return 0
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
 * Las casillas de alcotest del año: control (N°30/31) y envío (N°32). Devuelve
 * cuántas creó.
 *
 * Las dos series van juntas porque comparten tabla y se distinguen por `kind`,
 * que además forma parte del unique: una casilla de control y una de envío del
 * mismo mes no colisionan.
 */
export async function ensureAlcotestSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year: number,
  schedules?: ProgramSlotSchedules | null,
): Promise<number> {
  const resolved = await schedulesOrNull(client, year, schedules)
  const rows = [
    ...slotRows("alcotest-slot", worksiteId, year, resolved?.alcotestControl ?? [])
      .map((row) => ({ ...row, id: `${row.id}-control`, kind: "control" as const })),
    ...slotRows("alcotest-slot", worksiteId, year, resolved?.alcotestDispatch ?? [])
      .map((row) => ({ ...row, id: `${row.id}-envio`, kind: "envio" as const })),
  ]
  if (rows.length === 0) return 0
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
 * La casilla anual de evaluación cuantitativa de higiene (N°45). Devuelve
 * cuántas creó.
 *
 * Vive en este agregador y no como un mecanismo propio de higiene por la
 * misma razón que las demás familias: así la heredan los tres puntos de alta
 * de faena y el backfill de post-migración
 * (`scripts/ensure-prevention-program-slots.ts`) sin cablear nada nuevo.
 */
export async function ensureHygieneMeasurementSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  year: number,
  schedules?: ProgramSlotSchedules | null,
): Promise<number> {
  const resolved = await schedulesOrNull(client, year, schedules)
  const rows = slotRows("hygiene-slot", worksiteId, year, resolved?.hygieneMeasurements ?? [])
  if (rows.length === 0) return 0
  const created = await client.insert(preventionHygieneMeasurementSlots)
    .values(rows)
    .onConflictDoNothing({ target: [
      preventionHygieneMeasurementSlots.worksiteId,
      preventionHygieneMeasurementSlots.year,
      preventionHygieneMeasurementSlots.slotKey,
    ] })
    .returning({ id: preventionHygieneMeasurementSlots.id })
  return created.length
}

export type PreventionProgramSlotCounts = {
  training: number
  drills: number
  grdMeetings: number
  alcotest: number
  protocols: number
  hygieneMeasurements: number
}

/** Al activar, además: casillas pendientes que la planificación vigente ya no pide. */
export type PreventionProgramActivationSlotCounts = PreventionProgramSlotCounts & { staleRemoved: number }

/** Desde el período (mes, semana) inclusive. */
function fromPeriod(table: { scheduledMonth: AnyColumn; scheduledWeek: AnyColumn }, period: PdtpPeriod): SQL {
  return or(
    gt(table.scheduledMonth, period.month),
    and(eq(table.scheduledMonth, period.month), gte(table.scheduledWeek, period.week)),
  )!
}

/**
 * T6 (revisión de T5): la siembra sólo inserta (`onConflictDoNothing`). Una
 * revisión v+1 que mueve el simulacro de abril a mayo creaba la casilla de
 * mayo y dejaba viva la de abril, que el programa vigente ya no pide.
 *
 * Quita las casillas **pendientes, sin hecho y sin evidencia** del año que la
 * planificación vigente ya no pide, y sólo desde la semana de activación de
 * esa planificación: lo anterior lo planificó la versión que regía entonces y
 * sigue siendo exigible en su ventana (D24). Nunca toca una casilla cumplida,
 * no hecha o declarada no aplicable: ésas son hechos. Borrar y no "cancelar"
 * porque las tablas no tienen ese estado (y una migración está fuera de T6);
 * una casilla pendiente sin hecho ni evidencia no guarda nada que perder.
 */
async function removeStaleProgramSlotsTx(
  client: Client,
  worksiteId: string,
  year: number,
  schedules: ProgramSlotSchedules,
  since: PdtpPeriod,
): Promise<number> {
  const keys = (slots: readonly ProgramSlot[]) => slots.map((slot) => slot.slotKey)
  const families = [
    { table: preventionEmergencyDrillSlots, keys: keys(schedules.drills), fact: preventionEmergencyDrillSlots.drillId },
    { table: preventionGrdMeetingSlots, keys: keys(schedules.grdMeetings), fact: preventionGrdMeetingSlots.meetingId },
    { table: preventionHygieneMeasurementSlots, keys: keys(schedules.hygieneMeasurements), fact: preventionHygieneMeasurementSlots.measurementId },
  ] as const
  let removed = 0
  for (const family of families) {
    const deleted = await client.delete(family.table).where(and(
      eq(family.table.worksiteId, worksiteId),
      eq(family.table.year, year),
      eq(family.table.status, "pending"),
      isNull(family.fact),
      family.keys.length > 0 ? notInArray(family.table.slotKey, [...family.keys]) : undefined,
      fromPeriod(family.table, since),
    )).returning({ id: family.table.id })
    removed += deleted.length
  }
  for (const [kind, slots] of [["control", schedules.alcotestControl], ["envio", schedules.alcotestDispatch]] as const) {
    const wanted = keys(slots)
    const deleted = await client.delete(preventionAlcotestSlots).where(and(
      eq(preventionAlcotestSlots.worksiteId, worksiteId),
      eq(preventionAlcotestSlots.year, year),
      eq(preventionAlcotestSlots.kind, kind),
      eq(preventionAlcotestSlots.status, "pending"),
      isNull(preventionAlcotestSlots.testId),
      isNull(preventionAlcotestSlots.dispatchId),
      wanted.length > 0 ? notInArray(preventionAlcotestSlots.slotKey, wanted) : undefined,
      fromPeriod(preventionAlcotestSlots, since),
      notExists(client.select({ id: preventionAlcotestSlotEvidence.id }).from(preventionAlcotestSlotEvidence)
        .where(eq(preventionAlcotestSlotEvidence.slotId, preventionAlcotestSlots.id))),
    )).returning({ id: preventionAlcotestSlots.id })
    removed += deleted.length
  }
  return removed
}

/**
 * Todas las casillas del programa para una faena, en una llamada.
 *
 * Es lo que deben invocar los puntos de alta de faena. Con el cronograma 2026,
 * una faena nueva y activa queda con 390 casillas de capacitación, 2 de
 * simulacro, 4 de CGRD, 23 de alcotest (12 controles + 11 envíos), los 8
 * protocolos MINSAL sin pronunciar y 1 de evaluación cuantitativa de higiene
 * (N°45) por año que le corresponda (ver `resolveProgramSlotYearsForWorksite`).
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
 *
 * `years` fuerza los años (backfill con `PROGRAM_SLOTS_YEAR`, activación de un
 * programa); sin él se aplica la regla única.
 */
export async function ensurePreventionProgramSlotsForWorksiteTx(
  client: Client,
  worksiteId: string,
  options: { years?: number[] } = {},
): Promise<PreventionProgramSlotCounts> {
  const years = options.years ?? await resolveProgramSlotYearsForWorksite(client, worksiteId)
  const counts: PreventionProgramSlotCounts = {
    training: 0, drills: 0, grdMeetings: 0, alcotest: 0,
    protocols: await ensureProtocolApplicabilitiesForWorksiteTx(client, worksiteId),
    hygieneMeasurements: 0,
  }
  for (const year of years) {
    const schedules = await resolveProgramSlotSchedules(client, year)
    if (isTrainingCatalogYear(year)) counts.training += await ensurePreventionTrainingOccurrencesForWorksiteTx(client, worksiteId, year)
    if (!schedules) continue
    counts.drills += await ensureEmergencyDrillSlotsForWorksiteTx(client, worksiteId, year, schedules)
    counts.grdMeetings += await ensureGrdMeetingSlotsForWorksiteTx(client, worksiteId, year, schedules)
    counts.alcotest += await ensureAlcotestSlotsForWorksiteTx(client, worksiteId, year, schedules)
    counts.hygieneMeasurements += await ensureHygieneMeasurementSlotsForWorksiteTx(client, worksiteId, year, schedules)
  }
  return counts
}

/**
 * Al activar un programa: las casillas de su año en cada faena operativa. Una
 * transacción por faena, igual que el backfill, para que una falla no descarte
 * lo ya sembrado. Idempotente.
 */
export async function ensurePreventionProgramSlotsForProgram(programId: string): Promise<PreventionProgramActivationSlotCounts> {
  const [program] = await db.select({ year: pdtpPrograms.year, activatedAt: pdtpPrograms.activatedAt, status: pdtpPrograms.status })
    .from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  const totals: PreventionProgramActivationSlotCounts = { training: 0, drills: 0, grdMeetings: 0, alcotest: 0, protocols: 0, hygieneMeasurements: 0, staleRemoved: 0 }
  if (!program) return totals
  const since = pdtpActivationPeriod(program.activatedAt)
  for (const worksiteId of await listPdtpProgramOperatingWorksiteIds(programId)) {
    const counts = await db.transaction(async (tx) => {
      const seeded = await ensurePreventionProgramSlotsForWorksiteTx(tx, worksiteId, { years: [program.year] })
      // Sólo la versión vigente decide qué sobra, y sólo desde su activación.
      const schedules = program.status === "active" && since?.year === program.year
        ? await resolveProgramSlotSchedules(tx, program.year)
        : null
      const staleRemoved = schedules && since ? await removeStaleProgramSlotsTx(tx, worksiteId, program.year, schedules, since) : 0
      return { ...seeded, staleRemoved }
    })
    for (const key of Object.keys(totals) as Array<keyof PreventionProgramActivationSlotCounts>) totals[key] += counts[key]
  }
  return totals
}

/** Las casillas de simulacro de una faena y año, para la pantalla. */
export async function listEmergencyDrillSlots(client: Client, worksiteIds: string[], year: number) {
  if (worksiteIds.length === 0) return []
  return client.select().from(preventionEmergencyDrillSlots).where(and(
    inArray(preventionEmergencyDrillSlots.worksiteId, worksiteIds),
    eq(preventionEmergencyDrillSlots.year, year),
  ))
}

/** Las casillas de acta del CGRD de una faena y año, para la pantalla. */
export async function listGrdMeetingSlots(client: Client, worksiteId: string, year: number) {
  return client.select().from(preventionGrdMeetingSlots).where(and(
    eq(preventionGrdMeetingSlots.worksiteId, worksiteId),
    eq(preventionGrdMeetingSlots.year, year),
  ))
}

/** Las casillas de alcotest de una faena y año, para la pantalla. */
export async function listAlcotestSlots(client: Client, worksiteId: string, year: number) {
  return client.select().from(preventionAlcotestSlots).where(and(
    eq(preventionAlcotestSlots.worksiteId, worksiteId),
    eq(preventionAlcotestSlots.year, year),
  ))
}

/**
 * La semana desde la que el programa vigente del año le exige a esta faena, o
 * `null` si no hay programa activo del año.
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
export async function resolveProgramActivationPeriod(worksiteId: string | undefined, year: number) {
  const program = await activeProgramOfYear(db, year)
  if (!program) return pdtpActivationPeriod(null)
  const cutoff = worksiteId
    ? effectiveActivationFor(program.activatedAt, await loadWorksiteAddedAt(program.id, worksiteId))
    : program.activatedAt
  return pdtpActivationPeriod(cutoff ?? null)
}
