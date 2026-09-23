/**
 * lib/__tests__/pdtp-slot-deviation-propagation.test.ts
 *
 * El «no aplica» / «no hecha» de una casilla del programa llega al PDTP.
 *
 * Antes de `slot-deviation-connector.ts` ninguna de las cuatro familias de
 * casillas (simulacros N°84, sesiones del CGRD N°81, alcotest N°30/31/32,
 * ocurrencias de capacitación) escribía `pdtp_execution_deviations`: la celda
 * del programa seguía planificada y en cero, así que contaba como
 * incumplimiento aunque la pantalla de la casilla dijera que la actividad
 * «saldrá del programa de esta faena». Lo que se protege acá:
 *
 * - cada familia escribe el desvío correcto, en la celda de la casilla, con el
 *   motivo de la casilla y el actor que la cambió;
 * - la casilla es la fuente de verdad: sin programa activo, o con un error de
 *   SQL dentro del PDTP, la casilla cambia igual;
 * - corregir «no aplica» ↔ «no hecha» retira el desvío que la casilla propagó
 *   antes, y nunca pisa uno declarado a mano desde la planilla.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { ensurePreventionProgramSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
const { recordDrillSlotStatus } = await import("@/lib/services/prevention-emergency")
const { recordGrdMeetingSlotStatus, constituteGrdCommittee, recordGrdMeeting, annulGrdMeeting } = await import("@/lib/services/prevention-cgrd")
const { recordAlcotestSlotStatus } = await import("@/lib/services/prevention-alcotest-slots")
const { recordTrainingOccurrenceStatus } = await import("@/lib/services/prevention-training-occurrences")
const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
const { propagateSlotStatusToPdtp } = await import("@/lib/services/pdtp-adapters/slot-deviation-connector")

const YEAR = 2026
const PROGRAM_ID = "pdtp-slot-deviations-v1"
const WS = "ws-slot-deviations"
const USER_PRF = "user-slot-prf"
const USER_SUP = "user-slot-sup"
const USER_ADMIN = "user-slot-admin"

const scopeAll = { mode: "all", ids: [] } as WorksiteScope
const EMERGENCY = { userId: USER_PRF, scope: scopeAll, permissions: ["prevention:emergency:drill_execute"] }
const CGRD = { userId: USER_PRF, scope: scopeAll, permissions: ["prevention:cgrd:meeting:manage", "prevention:cgrd:committee:manage"] }
const TRAINING = { userId: USER_PRF, scope: scopeAll, permissions: ["prevention:training:view", "prevention:training:record"] }
const ALCOTEST_PRF = { userId: USER_PRF, scope: [WS], roles: ["prevencionista_faena"] }
const ALCOTEST_SUP = { userId: USER_SUP, scope: [WS], roles: ["supervisor_terreno"] }
const ALCOTEST_ADMIN = { userId: USER_ADMIN, scope: "all" as const, roles: ["administrador"] }

const activityId = (n: number) => `${PROGRAM_ID}-a-${String(n).padStart(3, "0")}`

/**
 * Programa 2026 activo con las actividades de las cuatro familias y
 * planificado en las celdas que declaran sus casillas (todas pasadas respecto
 * del 2026-09, así un «no hecha» no cae a futuro).
 */
async function seedActiveProgram() {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: YEAR, title: `PDTP ${YEAR} casillas`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  const cells: Array<{ n: number; month: number; week: number }> = [
    { n: 84, month: 3, week: 3 }, // simulacro m03-w3
    { n: 81, month: 2, week: 1 }, // sesión CGRD m02-w1
    { n: 30, month: 3, week: 3 }, // control alcotest m03-w3 (PRF)
    { n: 31, month: 3, week: 3 }, // control alcotest m03-w3 (Sup/JT)
    { n: 32, month: 3, week: 1 }, // envío alcotest m03-w1
    { n: 54, month: 9, week: 4 }, // CAP-02 m09-w4
  ]
  await inMemoryDb.insert(schema.pdtpActivities).values(cells.map(({ n }) => ({
    id: activityId(n), programId: PROGRAM_ID, n, activity: `Actividad N°${n}`, program: "Prevención PDTP",
    responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed", mechanism: "enganche",
    sourceSheetRow: n, createdAt: now, updatedAt: now,
  })))
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values(cells.map(({ n, month, week }) => ({
    id: `${activityId(n)}-s-${YEAR}-${String(month).padStart(2, "0")}-${week}`,
    activityId: activityId(n), year: YEAR, month, week, plannedQuantity: 1, sourceColumn: "test",
  })))
}

async function deviationsOf(n: number) {
  return inMemoryDb.select().from(schema.pdtpExecutionDeviations)
    .where(eq(schema.pdtpExecutionDeviations.activityId, activityId(n)))
}

async function activeDeviationsOf(n: number) {
  return inMemoryDb.select().from(schema.pdtpExecutionDeviations)
    .where(and(
      eq(schema.pdtpExecutionDeviations.activityId, activityId(n)),
      eq(schema.pdtpExecutionDeviations.status, "active"),
    ))
}

async function drillSlot(slotKey: string) {
  const [slot] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
    .where(and(eq(schema.preventionEmergencyDrillSlots.worksiteId, WS), eq(schema.preventionEmergencyDrillSlots.slotKey, slotKey)))
  return slot!
}

async function grdSlot(slotKey: string) {
  const [slot] = await inMemoryDb.select().from(schema.preventionGrdMeetingSlots)
    .where(and(eq(schema.preventionGrdMeetingSlots.worksiteId, WS), eq(schema.preventionGrdMeetingSlots.slotKey, slotKey)))
  return slot!
}

async function alcotestSlot(kind: "control" | "envio", slotKey: string) {
  const [slot] = await inMemoryDb.select().from(schema.preventionAlcotestSlots)
    .where(and(
      eq(schema.preventionAlcotestSlots.worksiteId, WS),
      eq(schema.preventionAlcotestSlots.kind, kind),
      eq(schema.preventionAlcotestSlots.slotKey, slotKey),
    ))
  return slot!
}

async function trainingOccurrence(code: string, slotKey: string) {
  const [row] = await inMemoryDb.select({ occurrence: schema.preventionTrainingOccurrences })
    .from(schema.preventionTrainingOccurrences)
    .innerJoin(schema.preventionTrainingCatalogItems, eq(schema.preventionTrainingOccurrences.catalogItemId, schema.preventionTrainingCatalogItems.id))
    .where(and(
      eq(schema.preventionTrainingOccurrences.worksiteId, WS),
      eq(schema.preventionTrainingCatalogItems.code, code),
      eq(schema.preventionTrainingOccurrences.slotKey, slotKey),
    ))
  return row!.occurrence
}

beforeEach(async () => {
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()

  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionProtocolApplicabilities)
  await inMemoryDb.delete(schema.preventionHygieneMeasurementSlots)
  await inMemoryDb.delete(schema.preventionAlcotestSlotEvidence)
  await inMemoryDb.delete(schema.preventionAlcotestSlots)
  await inMemoryDb.delete(schema.preventionGrdMeetingSlots)
  await inMemoryDb.delete(schema.preventionGrdAgreements)
  await inMemoryDb.delete(schema.preventionGrdMeetings)
  await inMemoryDb.delete(schema.preventionGrdMembers)
  await inMemoryDb.delete(schema.preventionGrdCommittees)
  await inMemoryDb.delete(schema.preventionEmergencyDrillSlots)
  await inMemoryDb.delete(schema.preventionTrainingOccurrenceEvidence)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: USER_PRF, name: "Prevencionista", email: "slot-prf@example.test", hashedPassword: "x" },
    { id: USER_SUP, name: "Supervisor", email: "slot-sup@example.test", hashedPassword: "x" },
    { id: USER_ADMIN, name: "Administración", email: "slot-admin@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WS, name: "Faena Casillas PDTP", code: "FCPDTP", isActive: true })
  await ensurePreventionProgramSlotsForWorksiteTx(inMemoryDb, WS)
})

describe("cada familia de casillas escribe su desvío en la celda del PDTP", () => {
  it("simulacro «no aplica» → N°84 `not_applicable` en m03-w3, y la celda sale del denominador", async () => {
    await seedActiveProgram()
    const before = await getPdtpComplianceIndicators(PROGRAM_ID, WS)
    const slot = await drillSlot("m03-w3")
    const reason = "La faena no tiene instalaciones fijas que evacuar."

    const updated = await recordDrillSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable", notApplicableReason: reason,
    }, EMERGENCY)
    expect(updated.status).toBe("not_applicable")

    const rows = await deviationsOf(84)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      worksiteId: WS, year: YEAR, month: 3, week: 3,
      kind: "not_applicable", reason, status: "active", createdByUserId: USER_PRF,
      targetMonth: null, targetWeek: null,
    })

    // Lo que la pantalla de la casilla promete: no cuenta ni como cumplida ni
    // como incumplida. Marzo tenía planificado el simulacro (1) y el control
    // de alcotest de las N°30/31 y el envío N°32 (3 más); la CAP-02 quedó en
    // septiembre/octubre tras alinearla con la grilla real del PDTP.
    const after = await getPdtpComplianceIndicators(PROGRAM_ID, WS)
    expect(after!.monthly[2]!.planned).toBe(before!.monthly[2]!.planned - 1)
  })

  it("sesión del CGRD «no hecha» → N°81 `not_performed` con la observación como motivo", async () => {
    await seedActiveProgram()
    const slot = await grdSlot("m02-w1")
    const observation = "El comité no sesionó: faltó quórum de los representantes."

    await recordGrdMeetingSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_completed", observation,
    }, CGRD)

    const rows = await deviationsOf(81)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      worksiteId: WS, year: YEAR, month: 2, week: 1,
      kind: "not_performed", reason: observation, status: "active", createdByUserId: USER_PRF,
    })
  })

  /* La otra vía que deja una casilla del CGRD en «no hecha»: anular el acta
   * que la cumplía. No pasa por `recordGrdMeetingSlotStatus`, y sin cablearla
   * el PDTP nunca se enteraba de ese incumplimiento declarado. */
  it("anular el acta que cumplía una casilla del CGRD → N°81 `not_performed` con el motivo de la anulación", async () => {
    await seedActiveProgram()
    const slot = await grdSlot("m02-w1")
    const committee = await constituteGrdCommittee({
      worksiteId: WS, name: "CGRD", constitutedOn: "2026-01-10", mandateEndsOn: "2028-01-10",
      evidenceUrl: "https://drive.chome.cl/cgrd-constitucion",
    }, CGRD)
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-02-03T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true,
      evidenceUrl: "https://drive.chome.cl/cgrd-acta", slotId: slot.id,
    }, CGRD)
    expect(await grdSlot("m02-w1")).toMatchObject({ status: "completed", meetingId: meeting.id })
    expect(await deviationsOf(81)).toHaveLength(0)

    const reason = "El acta se cargó en la faena equivocada."
    await annulGrdMeeting({ meetingId: meeting.id, reason }, CGRD)

    expect(await grdSlot("m02-w1")).toMatchObject({ status: "not_completed", meetingId: null })
    const rows = await deviationsOf(81)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      worksiteId: WS, year: YEAR, month: 2, week: 1,
      kind: "not_performed", status: "active", createdByUserId: USER_PRF,
    })
    expect(rows[0]!.reason).toBe(`Acta anulada: ${reason}`)
    // La acreditación del acta se revoca después del commit, igual que antes.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, activityId(81)))
    expect(executions.every((execution) => execution.status === "draft")).toBe(true)
  })

  it("anular el acta y después declarar la casilla «no aplica» reemplaza el `not_performed` que dejó la anulación", async () => {
    await seedActiveProgram()
    const slot = await grdSlot("m02-w1")
    const committee = await constituteGrdCommittee({
      worksiteId: WS, name: "CGRD", constitutedOn: "2026-01-10", mandateEndsOn: "2028-01-10",
      evidenceUrl: "https://drive.chome.cl/cgrd-constitucion",
    }, CGRD)
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-02-03T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true,
      evidenceUrl: "https://drive.chome.cl/cgrd-acta", slotId: slot.id,
    }, CGRD)
    await annulGrdMeeting({ meetingId: meeting.id, reason: "El acta se cargó en la faena equivocada." }, CGRD)

    const anulada = await grdSlot("m02-w1")
    const naReason = "Centro de trabajo con 12 personas: corresponde coordinador, no comité."
    await recordGrdMeetingSlotStatus({
      slotId: anulada.id, expectedVersion: anulada.version, status: "not_applicable", notApplicableReason: naReason,
    }, CGRD)

    expect(await activeDeviationsOf(81)).toEqual([expect.objectContaining({ kind: "not_applicable", reason: naReason })])
    expect(await deviationsOf(81)).toContainEqual(expect.objectContaining({ kind: "not_performed", status: "withdrawn" }))
  })

  it("envío de alcotest «no hecha» sin observación → N°32 `not_performed` con un motivo que nombra la casilla", async () => {
    await seedActiveProgram()
    const slot = await alcotestSlot("envio", "m03-w1")

    await recordAlcotestSlotStatus({ slotId: slot.id, expectedVersion: slot.version, status: "not_completed" }, ALCOTEST_PRF)

    const rows = await deviationsOf(32)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ month: 3, week: 1, kind: "not_performed", status: "active", createdByUserId: USER_PRF })
    // La observación es opcional en la casilla y el PDTP exige ≥10 caracteres.
    expect(rows[0]!.reason).toContain("m03-w1")
    expect(rows[0]!.reason.length).toBeGreaterThanOrEqual(10)
  })

  it("control de alcotest: la N°30 si declara un PRF, la N°31 si declara un supervisor — igual que al cumplirla", async () => {
    await seedActiveProgram()
    const marzo = await alcotestSlot("control", "m03-w3")
    const abril = await alcotestSlot("control", "m04-w3")
    const reason = "La faena no opera vehículos ni turnos nocturnos en marzo."

    await recordAlcotestSlotStatus({
      slotId: marzo.id, expectedVersion: marzo.version, status: "not_applicable", notApplicableReason: reason,
    }, ALCOTEST_PRF)
    expect(await deviationsOf(30)).toEqual([expect.objectContaining({ month: 3, week: 3, kind: "not_applicable", reason, createdByUserId: USER_PRF })])
    expect(await deviationsOf(31)).toHaveLength(0)

    // Abril no tiene planificado en este programa: el PDTP rechaza, la casilla cambia igual.
    const aprilUpdated = await recordAlcotestSlotStatus({
      slotId: abril.id, expectedVersion: abril.version, status: "not_applicable", notApplicableReason: reason,
    }, ALCOTEST_SUP)
    expect(aprilUpdated.status).toBe("not_applicable")
    expect(await deviationsOf(31)).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ module: "alcotest", activityN: 31 }),
      expect.stringContaining("rechazó el desvío"),
    )
  })

  it("control de alcotest declarado por un supervisor → N°31", async () => {
    await seedActiveProgram()
    const marzo = await alcotestSlot("control", "m03-w3")
    await recordAlcotestSlotStatus({
      slotId: marzo.id, expectedVersion: marzo.version, status: "not_completed",
      observation: "El alcotómetro estuvo en calibración todo el mes.",
    }, ALCOTEST_SUP)
    expect(await deviationsOf(30)).toHaveLength(0)
    expect(await deviationsOf(31)).toEqual([expect.objectContaining({ kind: "not_performed", createdByUserId: USER_SUP })])
  })

  it("control de alcotest declarado por un rol sin N°30/31 → la casilla cambia y no se inventa la actividad", async () => {
    await seedActiveProgram()
    const marzo = await alcotestSlot("control", "m03-w3")
    const updated = await recordAlcotestSlotStatus({
      slotId: marzo.id, expectedVersion: marzo.version, status: "not_applicable",
      notApplicableReason: "La faena no opera vehículos ni turnos nocturnos.",
    }, ALCOTEST_ADMIN)
    expect(updated.status).toBe("not_applicable")
    expect(await deviationsOf(30)).toHaveLength(0)
    expect(await deviationsOf(31)).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ module: "alcotest", declareOnActivityNumbers: [] }),
      expect.stringContaining("Ninguna actividad PDTP corresponde"),
    )
  })

  it("ocurrencia de capacitación «no aplica» → la actividad de su catálogo (N°54) en su período planificado", async () => {
    await seedActiveProgram()
    const occurrence = await trainingOccurrence("CAP-02", "m09-w4")
    const reason = "La faena no tiene extintores propios: los provee el mandante."

    await recordTrainingOccurrenceStatus({
      occurrenceId: occurrence.id, expectedVersion: occurrence.version, status: "not_applicable", notApplicableReason: reason,
    }, TRAINING)

    expect(await deviationsOf(54)).toEqual([expect.objectContaining({
      worksiteId: WS, year: YEAR, month: 9, week: 4, kind: "not_applicable", reason, status: "active", createdByUserId: USER_PRF,
    })])
  })

  it("capacitación que sale de «hecha» a «no aplica»: el desvío se escribe después de revocar la acreditación", async () => {
    await seedActiveProgram()
    const occurrence = await trainingOccurrence("CAP-02", "m09-w4")
    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values({
      id: "slot-dev-evidence-1", occurrenceId: occurrence.id, fileName: "acta.pdf",
      storagePath: "storage/prevention-training-evidence/slot-dev-acta.pdf", mimeType: "application/pdf",
      fileSizeBytes: 128, sha256: "a".repeat(64), state: "active", uploadedByUserId: USER_PRF,
    })
    const completed = await recordTrainingOccurrenceStatus({
      occurrenceId: occurrence.id, expectedVersion: occurrence.version, status: "completed",
    }, TRAINING)
    const [accredited] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, activityId(54)))
    expect(accredited).toMatchObject({ month: 9, week: 4, status: "approved", executedQuantity: 1 })

    const reason = "Se registró por error: la faena no tiene extintores propios."
    await recordTrainingOccurrenceStatus({
      occurrenceId: occurrence.id, expectedVersion: completed.version, status: "not_applicable", notApplicableReason: reason,
    }, TRAINING)

    const [revoked] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, activityId(54)))
    expect(revoked!.status).toBe("draft")
    expect(await activeDeviationsOf(54)).toEqual([expect.objectContaining({ month: 9, week: 4, kind: "not_applicable", reason })])
  })
})

describe("la casilla es la fuente de verdad: el PDTP nunca bloquea su cambio de estado", () => {
  it("sin programa PDTP activo, las cuatro familias cambian de estado y no queda ningún desvío", async () => {
    const reason = "No corresponde en esta faena durante el período."
    const drill = await drillSlot("m03-w3")
    const grd = await grdSlot("m02-w1")
    const control = await alcotestSlot("control", "m03-w3")
    const occurrence = await trainingOccurrence("CAP-02", "m09-w4")

    await expect(recordDrillSlotStatus({ slotId: drill.id, expectedVersion: drill.version, status: "not_applicable", notApplicableReason: reason }, EMERGENCY))
      .resolves.toMatchObject({ status: "not_applicable" })
    await expect(recordGrdMeetingSlotStatus({ slotId: grd.id, expectedVersion: grd.version, status: "not_completed" }, CGRD))
      .resolves.toMatchObject({ status: "not_completed" })
    await expect(recordAlcotestSlotStatus({ slotId: control.id, expectedVersion: control.version, status: "not_applicable", notApplicableReason: reason }, ALCOTEST_PRF))
      .resolves.toMatchObject({ status: "not_applicable" })
    await expect(recordTrainingOccurrenceStatus({ occurrenceId: occurrence.id, expectedVersion: occurrence.version, status: "not_applicable", notApplicableReason: reason }, TRAINING))
      .resolves.toMatchObject({ status: "not_applicable" })

    expect(await inMemoryDb.select().from(schema.pdtpExecutionDeviations)).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Sin programa PDTP activo"))
  })

  it("un mes cerrado del PDTP rechaza el desvío dentro de su savepoint y la casilla cambia igual", async () => {
    await seedActiveProgram()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
      id: "closure-marzo", programId: PROGRAM_ID, worksiteId: WS, year: YEAR, month: 3,
      status: "closed", snapshotJson: {}, digest: "d".repeat(64),
      closedByUserId: USER_PRF, closedAt: now, closeReason: "Cierre mensual de marzo.",
      createdAt: now, updatedAt: now,
    })
    const slot = await drillSlot("m03-w3")

    const updated = await recordDrillSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable",
      notApplicableReason: "La faena no tiene instalaciones fijas que evacuar.",
    }, EMERGENCY)

    expect(updated.status).toBe("not_applicable")
    const [persisted] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot.id))
    expect(persisted!.status).toBe("not_applicable")
    expect(await deviationsOf(84)).toHaveLength(0)
    // El rechazo ocurrió DENTRO del savepoint, después de tomar el advisory
    // lock de la celda: es la regla de mes cerrado de `recordPdtpDeviation`.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ activityN: 84, err: expect.objectContaining({ message: expect.stringContaining("cerrado") }) }),
      expect.stringContaining("rechazó el desvío"),
    )
  })

  it("un error de SQL dentro del PDTP se deshace en su savepoint: la transacción de la casilla sigue viva y confirma", async () => {
    await seedActiveProgram()
    const slot = await drillSlot("m03-w3")

    await inMemoryDb.transaction(async (tx) => {
      await tx.update(schema.preventionEmergencyDrillSlots)
        .set({ observation: "cambio de la casilla", updatedAt: new Date().toISOString() })
        .where(eq(schema.preventionEmergencyDrillSlots.id, slot.id))
      // Un autor inexistente viola la FK de `created_by_user_id` en el INSERT
      // del desvío: error de Postgres, no una validación en JS.
      await propagateSlotStatusToPdtp(tx as Tx, {
        source: { module: "emergencias", slotId: slot.id, label: "de simulacro m03-w3" },
        worksiteId: WS,
        cell: { year: YEAR, month: 3, week: 3 },
        activities: { activityNumbers: [84] },
        next: { kind: "not_applicable", reason: "La faena no tiene instalaciones fijas que evacuar." },
        previous: null,
        userId: "usuario-que-no-existe",
      })
      // Si el error hubiera abortado la transacción, esto fallaría con
      // "current transaction is aborted".
      await tx.select().from(schema.preventionEmergencyDrillSlots).limit(1)
    })

    const [persisted] = await inMemoryDb.select().from(schema.preventionEmergencyDrillSlots)
      .where(eq(schema.preventionEmergencyDrillSlots.id, slot.id))
    expect(persisted!.observation).toBe("cambio de la casilla")
    expect(await deviationsOf(84)).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ activityN: 84 }),
      expect.stringContaining("rechazó el desvío"),
    )
  })
})

describe("corregir la casilla corrige su desvío, y sólo el suyo", () => {
  it("«no aplica» → «no hecha»: retira el `not_applicable` que propagó y la celda vuelve al denominador", async () => {
    await seedActiveProgram()
    const baseline = await getPdtpComplianceIndicators(PROGRAM_ID, WS)
    const slot = await drillSlot("m03-w3")
    const na = await recordDrillSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable",
      notApplicableReason: "La faena no tiene instalaciones fijas que evacuar.",
    }, EMERGENCY)

    await recordDrillSlotStatus({
      slotId: slot.id, expectedVersion: na.version, status: "not_completed",
      observation: "Sí aplicaba: el simulacro se suspendió por lluvia y no se reprogramó.",
    }, EMERGENCY)

    const rows = await deviationsOf(84)
    expect(rows).toHaveLength(2)
    const withdrawn = rows.find((row) => row.kind === "not_applicable")!
    expect(withdrawn).toMatchObject({ status: "withdrawn", withdrawnByUserId: USER_PRF })
    expect(withdrawn.withdrawReason).toContain("m03-w3")
    expect(rows.find((row) => row.status === "active")).toMatchObject({
      kind: "not_performed", reason: "Sí aplicaba: el simulacro se suspendió por lluvia y no se reprogramó.",
    })
    const after = await getPdtpComplianceIndicators(PROGRAM_ID, WS)
    expect(after!.monthly[2]!.planned).toBe(baseline!.monthly[2]!.planned)
  })

  it("«no hecha» → «no aplica» en el control de alcotest, aunque lo corrija alguien del otro rol", async () => {
    await seedActiveProgram()
    const slot = await alcotestSlot("control", "m03-w3")
    const nc = await recordAlcotestSlotStatus({ slotId: slot.id, expectedVersion: slot.version, status: "not_completed" }, ALCOTEST_PRF)
    expect(await activeDeviationsOf(30)).toEqual([expect.objectContaining({ kind: "not_performed" })])

    const reason = "La faena no opera vehículos ni turnos nocturnos en marzo."
    await recordAlcotestSlotStatus({
      slotId: slot.id, expectedVersion: nc.version, status: "not_applicable", notApplicableReason: reason,
    }, ALCOTEST_SUP)

    // El `not_performed` que propagó la casilla en la N°30 ya no dice la verdad…
    expect(await activeDeviationsOf(30)).toHaveLength(0)
    expect(await deviationsOf(30)).toEqual([expect.objectContaining({ kind: "not_performed", status: "withdrawn", withdrawnByUserId: USER_SUP })])
    // …y el «no aplica» nuevo cae en la actividad del rol de quien lo declara.
    expect(await activeDeviationsOf(31)).toEqual([expect.objectContaining({ kind: "not_applicable", reason, createdByUserId: USER_SUP })])
  })

  it("no pisa un desvío que alguien declaró a mano desde la planilla del PDTP", async () => {
    await seedActiveProgram()
    const manualReason = "Declarado desde la planilla: la faena estuvo paralizada en marzo."
    await recordPdtpDeviation({
      activityId: activityId(84), worksiteId: WS, year: YEAR, month: 3, week: 3,
      kind: "not_performed", reason: manualReason,
    }, USER_ADMIN, "all")
    const slot = await drillSlot("m03-w3")

    const updated = await recordDrillSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable",
      notApplicableReason: "La faena no tiene instalaciones fijas que evacuar.",
    }, EMERGENCY)

    expect(updated.status).toBe("not_applicable")
    expect(await deviationsOf(84)).toEqual([expect.objectContaining({
      kind: "not_performed", reason: manualReason, status: "active", createdByUserId: USER_ADMIN,
    })])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ activityN: 84 }),
      expect.stringContaining("no declaró esta casilla"),
    )
  })
})
