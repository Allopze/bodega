/**
 * lib/__tests__/pdtp-scheduled-instance-integrity.test.ts
 *
 * PREV-I08 (tanda T3): una ocurrencia programada y la ejecución del libro que
 * la cumple son el mismo hecho.
 *
 * - c: la vía manual no completa (D19) y respeta el mes cerrado en todas sus
 *   acciones; el estado "cumplida" sólo lo deriva el servidor desde la
 *   ejecución aprobada, con orden de bloqueo ejecución → ocurrencia.
 * - d: el enlace ya no pasa la `evidenceRef` descriptiva del conector (que no
 *   es un archivo PDTP y hacía fallar el enlace para siempre).
 * - e: aprobar y rechazar la ejecución sincronizan la ocurrencia.
 * - f: el conector acepta las fuentes declaradas como binding.
 * - b: revocar la fuente reabre la ocurrencia y la desenlaza, dentro de un
 *   savepoint: una falla de la ocurrencia no revierte la anulación de origen.
 * - a (residual): la carga manual de la misma semana no suma encima de la
 *   ocurrencia, y una ocurrencia completada con su ejecución no aprobada no
 *   cuenta.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { recordPdtpFulfillmentEvent, recordPdtpFulfillmentRevocation } = await import("@/lib/services/pdtp/fulfillment")
const { recordPdtpScheduledInstanceOutcome } = await import("@/lib/services/pdtp/scheduled-execution")
const { reviewPdtpScheduledInstanceOutcome } = await import("@/lib/services/pdtp/scheduled-outcome-review")
const { approvePdtpExecution, rejectPdtpExecution } = await import("@/lib/services/pdtp/executions")
const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
const { revokePdtpAccreditationWithClient } = await import("@/lib/services/pdtp/accreditation")

const Y = chileDateParts().year
const PROGRAM = "pdtp-si-integrity"
const ACT = "pdtp-si-act"
const ACT_N = 42
const WS = "ws-si"
const EXECUTOR = "user-si-exec"
const APPROVER = "user-si-approver"
const INST_A = "inst-si-a" // 02-03
const INST_B = "inst-si-b" // 20-03
const nowIso = () => new Date().toISOString()

type ConnectorKey = "inspections" | "campaigns" | "training" | "hygiene"
type Policy = "manual_confirmed" | "source_completed" | "source_approved" | "checklist_completed"

async function seedConfig(input: { connector: ConnectorKey; policy?: Policy; evidenceRequired?: boolean; acceptedKinds?: string[] }) {
  const now = nowIso()
  await inMemoryDb.insert(schema.pdtpActivityExecutionConfigs).values({
    id: "cfg-si", activityId: ACT, destinationConnectorKey: input.connector,
    completionPolicy: input.policy ?? "source_completed",
    evidenceRequired: input.evidenceRequired ?? false,
    acceptedEvidenceKinds: input.acceptedKinds ?? [],
    createdAt: now, updatedAt: now,
  })
}

async function seedInstance(id: string, scheduledFor: string, overrides: Partial<typeof schema.pdtpScheduledInstances.$inferInsert> = {}) {
  const now = nowIso()
  await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
    id, programId: PROGRAM, activityId: ACT, worksiteId: WS, scheduledFor,
    isoWeekYear: Y, isoWeek: 10, plannedQuantity: 1, status: "pending",
    idempotencyKey: `pdtp-scheduled:${ACT}:${WS}:${scheduledFor}`, sourceMetadataJson: {},
    createdAt: now, updatedAt: now, ...overrides,
  })
}

async function closeMonth(month: number) {
  const now = nowIso()
  await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
    id: `closure-si-${month}`, programId: PROGRAM, worksiteId: WS, year: Y, month, status: "closed",
    snapshotJson: {}, digest: "a".repeat(64), closedByUserId: APPROVER, closedAt: now, closeReason: "Cierre de prueba del mes",
    createdAt: now, updatedAt: now,
  })
}

/** PREV-C07 (0334): "no aplica" y cancelar nacen en revisión; otra persona aprueba. */
async function approvePendingOutcome(instanceId: string) {
  const [request] = await inMemoryDb.select().from(schema.pdtpScheduledInstanceOutcomeRequests)
    .where(eq(schema.pdtpScheduledInstanceOutcomeRequests.instanceId, instanceId))
  return reviewPdtpScheduledInstanceOutcome({ requestId: request!.id, decision: "approve" }, APPROVER, "all")
}

async function instance(id: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpScheduledInstances).where(eq(schema.pdtpScheduledInstances.id, id))
  return row!
}

async function executionForSource(sourceId: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.sourceId, sourceId))
  return row!
}

async function marchIndicator() {
  const indicators = await getPdtpComplianceIndicators(PROGRAM, WS)
  return indicators!.monthly[2]!
}

const fact = (input: { sourceType: "inspeccion" | "campana" | "capacitacion_ocurrencia" | "vigilancia"; sourceId: string; day: string; autoApprove?: boolean; evidenceRef?: string; metadata?: Record<string, unknown> }) =>
  recordPdtpFulfillmentEvent({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    worksiteId: WS,
    activityNumbers: [ACT_N],
    occurredAt: `${Y}-${input.day}T15:00:00.000Z`,
    ...(input.autoApprove ? { autoApproveByUserId: EXECUTOR } : {}),
    ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })

beforeEach(async () => {
  await pg.exec("DROP TRIGGER IF EXISTS si_fail_instance_update ON pdtp_scheduled_instances")
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.operationalActivityEvents)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpFulfillmentEventTargets)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpScheduledInstanceOutcomeRequests)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpActivityExecutionConfigs)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = nowIso()
  await inMemoryDb.insert(schema.users).values([EXECUTOR, APPROVER].map((id) => ({ id, name: id, email: `${id}@test`, hashedPassword: "x" })))
  await inMemoryDb.insert(schema.worksites).values({ id: WS, name: "Faena ocurrencias", code: "FO", isActive: true })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM, version: 1, year: Y, title: `PDTP ${Y} ocurrencias`, status: "active", appliesToAllWorksites: true,
    elaboratedByName: "X", elaboratedByTitle: "Y", activatedAt: `${Y}-01-01T03:00:00.000Z`,
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT, programId: PROGRAM, n: ACT_N, activity: "Inspección programada", program: "Prevención PDTP",
    responsibleSlugs: [], responsibleDisplay: "Prevencionista", scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "constancia", scheduleDefinition: { version: 1, kind: "one_time", date: `${Y}-03-02` },
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
  // Dos ocurrencias en marzo: con una sola, el tope por actividad y mes
  // escondería cualquier doble conteo.
  await seedInstance(INST_A, `${Y}-03-02`)
  await seedInstance(INST_B, `${Y}-03-20`)
})

/* Revisión final 2026-09-27 (hallazgo 5): la materialización corta por el día
 * de activación en hora de Chile (`todayInChile(activatedAt)`), pero el
 * indicador cortaba por la fecha UTC (`activatedAt.slice(0, 10)`). Una
 * activación a las 22:00 de Chile ya es el día siguiente en UTC: la ocurrencia
 * de ese día quedaba materializada por la versión y fuera de su indicador, y
 * contada en el de la versión anterior. */
describe("hallazgo 5 — el día de activación se mide en Chile", () => {
  // 02-03 a las 22:00 en Chile (UTC-3 en marzo) = 03-03 01:00 UTC.
  const ACTIVATED_22H_CHILE = `${Y}-03-03T01:00:00.000Z`
  // Postgres devuelve `timestamptz` en la zona de la sesión. PGlite usa
  // `Etc/GMT+4`, que escondía el defecto (01:00Z se lee "21:00-04" del día
  // anterior); el Postgres del despliegue corre en UTC.
  let previousTimeZone = "Etc/GMT+4"
  beforeEach(async () => {
    previousTimeZone = String((await pg.query<{ TimeZone: string }>("SHOW TIME ZONE")).rows[0]!.TimeZone)
    await pg.exec("SET TIME ZONE 'UTC'")
  })
  afterEach(async () => {
    await pg.exec(`SET TIME ZONE '${previousTimeZone}'`)
  })

  it("la ocurrencia del día de activación (hora de Chile) cuenta en el indicador de la versión", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ activatedAt: ACTIVATED_22H_CHILE }).where(eq(schema.pdtpPrograms.id, PROGRAM))
    expect(await marchIndicator()).toMatchObject({ planned: 2 })
  })

  it("y deja de contar en la versión anterior, cuya ventana termina ese día", async () => {
    const now = nowIso()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, PROGRAM))
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: `${PROGRAM}-v2`, version: 2, year: Y, title: `PDTP ${Y} ocurrencias v2`, status: "active", appliesToAllWorksites: true,
      elaboratedByName: "X", elaboratedByTitle: "Y", activatedAt: ACTIVATED_22H_CHILE,
      creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      createdAt: now, updatedAt: now,
    })
    // Las dos ocurrencias (02-03 y 20-03) ya son de la v2.
    expect(await marchIndicator()).toMatchObject({ planned: 0 })
  })
})

describe("vía manual (PREV-I08-c)", () => {
  it("no completa a mano: la ocurrencia se completa al aprobar su ejecución", async () => {
    await seedConfig({ connector: "inspections", policy: "manual_confirmed" })
    await expect(recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "complete", userId: EXECUTOR }))
      .rejects.toThrow(/aprobar/i)
    expect((await instance(INST_A)).status).toBe("pending")
  })

  it("enviar, 'no aplica' y cancelar respetan el mes cerrado", async () => {
    await seedConfig({ connector: "inspections" })
    await closeMonth(3)
    await expect(recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "submit", userId: EXECUTOR })).rejects.toThrow(/cerrado/)
    await expect(recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "not_applicable", userId: EXECUTOR, reason: "La faena estuvo detenida todo el mes" })).rejects.toThrow(/cerrado/)
    await expect(recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "cancel", userId: EXECUTOR, reason: "Duplicada" })).rejects.toThrow(/cerrado/)
    expect((await instance(INST_A)).status).toBe("pending")
  })

  /* Revisión final 2026-09-27 (hallazgo 8): cancelar saca la ocurrencia del
   * denominador igual que "no aplica" (que desde T2 exige 10 caracteres), y
   * bastaban 3. */
  it("cancelar exige un motivo de al menos 10 caracteres", async () => {
    await seedConfig({ connector: "inspections" })
    await expect(recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "cancel", userId: EXECUTOR, reason: "Duplicada" }))
      .rejects.toThrow(/motivo de cancelación debe tener al menos 10 caracteres/)
    expect((await instance(INST_A)).status).toBe("pending")
    const requested = await recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "cancel", userId: EXECUTOR, reason: "Duplicada con la ocurrencia del 20" })
    // PREV-C07 (0334): queda en revisión hasta que otra persona la aprueba.
    expect(requested.status).toBe("pending")
    await approvePendingOutcome(INST_A)
    expect((await instance(INST_A)).status).toBe("cancelled")
  })

  it("con el mes abierto, 'no aplica' sigue funcionando", async () => {
    await seedConfig({ connector: "inspections" })
    const requested = await recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "not_applicable", userId: EXECUTOR, reason: "La faena estuvo detenida todo el mes" })
    expect(requested.outcomeRequestId).toBeTruthy()
    await approvePendingOutcome(INST_A)
    expect((await instance(INST_A)).status).toBe("not_applicable")
  })
})

describe("enlace con la ejecución del libro (PREV-I08-d/e/f)", () => {
  it("una evidencia descriptiva del conector no deja la ocurrencia pendiente", async () => {
    await seedConfig({ connector: "inspections", evidenceRequired: true, acceptedKinds: ["generated_record"] })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true, evidenceRef: "Inspección completada: run-1" })
    const row = await instance(INST_A)
    const execution = await executionForSource("run-1")
    expect(row.status).toBe("completed")
    expect(row.sourceMetadataJson).toMatchObject({ executionId: execution.id, sourceRecordId: "run-1", sourceType: "inspeccion" })
    expect(execution.scheduledInstanceId).toBe(INST_A)
    // Una sola vez: la ocurrencia completada y su ejecución son el mismo hecho.
    expect(await marchIndicator()).toMatchObject({ planned: 2, executed: 1 })
  })

  it("una fuente que no se autoaprueba deja la ocurrencia enviada y no cuenta; los metadatos del conector no se copian", async () => {
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02", metadata: { sourceApproved: true, approvalStatus: "approved" } })
    const row = await instance(INST_A)
    expect(row.status).toBe("submitted")
    expect(row.sourceMetadataJson).not.toHaveProperty("sourceApproved")
    expect(row.sourceMetadataJson).not.toHaveProperty("approvalStatus")
    expect((await executionForSource("camp-1")).scheduledInstanceId).toBe(INST_A)
    expect(await marchIndicator()).toMatchObject({ planned: 2, executed: 0 })
  })

  it("aprobar la ejecución completa la ocurrencia", async () => {
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    const execution = await executionForSource("camp-1")
    await approvePdtpExecution(execution.id, APPROVER, "all")
    const row = await instance(INST_A)
    expect(row.status).toBe("completed")
    expect(row.completedByUserId).toBe(APPROVER)
    expect(row.completedAt).toBeTruthy()
    expect(await marchIndicator()).toMatchObject({ planned: 2, executed: 1 })
  })

  it("rechazar devuelve la ocurrencia a pendiente sin desenlazar; aprobar tras el reenvío la completa", async () => {
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    const execution = await executionForSource("camp-1")
    await rejectPdtpExecution(execution.id, APPROVER, "Falta el acta de la campaña", "all")
    expect((await instance(INST_A)).status).toBe("pending")
    expect((await executionForSource("camp-1")).scheduledInstanceId).toBe(INST_A)
    // #23: una rechazada no se aprueba directo; antes el test lo hacía y así
    // fijaba el defecto. El reenvío del mismo hecho la devuelve a 'submitted'.
    await expect(approvePdtpExecution(execution.id, APPROVER, "all")).rejects.toThrow(/submitted/)
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    expect((await executionForSource("camp-1")).status).toBe("submitted")
    await approvePdtpExecution(execution.id, APPROVER, "all")
    expect((await instance(INST_A)).status).toBe("completed")
  })

  it("no se aprueba si el mes de la ocurrencia enlazada está cerrado", async () => {
    await inMemoryDb.delete(schema.pdtpScheduledInstances)
    await seedInstance("inst-si-feb", `${Y}-02-16`)
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    const execution = await executionForSource("camp-1")
    expect(execution.scheduledInstanceId).toBe("inst-si-feb")
    await closeMonth(2)
    await expect(approvePdtpExecution(execution.id, APPROVER, "all")).rejects.toThrow(/febrero.*cerrado/)
    expect((await executionForSource("camp-1")).status).toBe("submitted")
  })

  it("no enlaza el hecho a una ocurrencia de un mes cerrado: cuenta en su propio mes", async () => {
    await inMemoryDb.delete(schema.pdtpScheduledInstances)
    await seedInstance("inst-si-feb", `${Y}-02-16`)
    await seedConfig({ connector: "inspections" })
    await closeMonth(2)
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    expect((await executionForSource("run-1")).scheduledInstanceId).toBeNull()
    expect((await instance("inst-si-feb")).status).toBe("pending")
  })

  it("tras un rechazo, un hecho nuevo toma la ocurrencia y desenlaza la ejecución rechazada", async () => {
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    const first = await executionForSource("camp-1")
    await rejectPdtpExecution(first.id, APPROVER, "Falta el acta de la campaña", "all")
    await fact({ sourceType: "campana", sourceId: "camp-2", day: "03-02" })
    expect((await executionForSource("camp-1")).scheduledInstanceId).toBeNull()
    expect((await executionForSource("camp-2")).scheduledInstanceId).toBe(INST_A)
    expect((await instance(INST_A)).status).toBe("submitted")
  })

  it("con política manual_confirmed también se enlaza cuando llega el hecho", async () => {
    await seedConfig({ connector: "inspections", policy: "manual_confirmed" })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    expect((await instance(INST_A)).status).toBe("completed")
    expect(await marchIndicator()).toMatchObject({ planned: 2, executed: 1 })
  })

  it("una ocurrencia de capacitación certificada cumple su instancia (binding del conector)", async () => {
    await seedConfig({ connector: "training" })
    await fact({ sourceType: "capacitacion_ocurrencia", sourceId: "occ-1", day: "03-02", autoApprove: true })
    expect((await instance(INST_A)).status).toBe("completed")
  })

  it("un control de vigilancia sin autoaprobación enlaza su instancia como enviada", async () => {
    await seedConfig({ connector: "hygiene" })
    await fact({ sourceType: "vigilancia", sourceId: "vig-1", day: "03-02" })
    expect((await instance(INST_A)).status).toBe("submitted")
    expect((await executionForSource("vig-1")).scheduledInstanceId).toBe(INST_A)
  })
})

describe("revocación (PREV-I08-b)", () => {
  it("revocar la fuente reabre la ocurrencia y la desenlaza", async () => {
    await seedConfig({ connector: "inspections" })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    expect((await instance(INST_A)).status).toBe("completed")

    await recordPdtpFulfillmentRevocation({ sourceType: "inspeccion", sourceId: "run-1", worksiteId: WS, reason: "Inspección reabierta" })
    const row = await instance(INST_A)
    expect(row.status).toBe("pending")
    expect(row.completedAt).toBeNull()
    expect(row.sourceMetadataJson).not.toHaveProperty("executionId")
    expect(row.sourceMetadataJson).toMatchObject({ reopenReason: "Inspección reabierta" })
    const execution = await executionForSource("run-1")
    expect(execution.status).toBe("draft")
    expect(execution.scheduledInstanceId).toBeNull()
    expect(await marchIndicator()).toMatchObject({ executed: 0 })
  })

  it("volver a completar la misma fuente vuelve a cumplir la ocurrencia", async () => {
    await seedConfig({ connector: "inspections" })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    await recordPdtpFulfillmentRevocation({ sourceType: "inspeccion", sourceId: "run-1", worksiteId: WS, reason: "Inspección reabierta" })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    expect((await instance(INST_A)).status).toBe("completed")
    expect(await marchIndicator()).toMatchObject({ executed: 1 })
  })

  it("revocar una ejecución enlazada a una ocurrencia cancelada no la reabre", async () => {
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    await recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "cancel", userId: EXECUTOR, reason: "Duplicada con otra ocurrencia" })
    await approvePendingOutcome(INST_A)
    const execution = await executionForSource("camp-1")
    await approvePdtpExecution(execution.id, APPROVER, "all")
    expect((await instance(INST_A)).status).toBe("cancelled")
    // La ocurrencia cancelada no cuenta: la ejecución aprobada cuenta por el libro.
    expect(await marchIndicator()).toMatchObject({ planned: 1, executed: 1 })

    await recordPdtpFulfillmentRevocation({ sourceType: "campana", sourceId: "camp-1", worksiteId: WS, reason: "Campaña anulada" })
    expect((await instance(INST_A)).status).toBe("cancelled")
  })

  it("una falla al reabrir la ocurrencia no revierte la revocación de la fuente", async () => {
    await seedConfig({ connector: "inspections" })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    await pg.exec(`
      CREATE OR REPLACE FUNCTION si_fail_instance_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falla simulada de la ocurrencia'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER si_fail_instance_update BEFORE UPDATE ON pdtp_scheduled_instances
        FOR EACH ROW EXECUTE FUNCTION si_fail_instance_update();
    `)
    // Transacción del módulo de origen (como `onInspectionReverted` con cliente).
    await inMemoryDb.transaction(async (tx) => {
      await revokePdtpAccreditationWithClient({ sourceType: "inspeccion", sourceId: "run-1", worksiteId: WS, reason: "Inspección reabierta" }, tx as never)
      await tx.execute(sql`SELECT 1`)
    })
    expect((await executionForSource("run-1")).status).toBe("draft")
  })
})

describe("indicador: un solo conteo por hecho (PREV-I08-a, residuales)", () => {
  it("una carga manual en la misma semana que la acreditación enlazada no suma encima de la ocurrencia", async () => {
    await seedConfig({ connector: "inspections" })
    await fact({ sourceType: "inspeccion", sourceId: "run-1", day: "03-02", autoApprove: true })
    const now = nowIso()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-manual-si", activityId: ACT, worksiteId: WS, year: Y, month: 3, week: 1, executedQuantity: 1,
      status: "approved", origin: "manual", executedByUserId: EXECUTOR, approvedByUserId: APPROVER, approvedAt: now,
      evidencePhotos: [], sourceMetadataJson: {}, createdAt: now, updatedAt: now,
    })
    expect(await marchIndicator()).toMatchObject({ planned: 2, executed: 1 })
  })

  it("el reporte de gestión cuenta el hecho en el mes de su ocurrencia, igual que el indicador", async () => {
    const { getPdtpManagementReport } = await import("@/lib/services/pdtp/management-report")
    await seedConfig({ connector: "inspections" })
    // Una actividad del creador nuevo con celdas de grilla además de sus
    // ocurrencias: es lo que ven las vistas que no representan ocurrencias.
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
      { id: "sched-si-3-1", activityId: ACT, year: Y, month: 3, week: 1, plannedQuantity: 1, sourceColumn: "manual" },
      { id: "sched-si-4-1", activityId: ACT, year: Y, month: 4, week: 1, plannedQuantity: 1, sourceColumn: "manual" },
    ])
    // Hecho del 2 de abril: se enlaza a la ocurrencia del 20 de marzo.
    await fact({ sourceType: "inspeccion", sourceId: "run-abril", day: "04-02", autoApprove: true })
    expect((await instance(INST_B)).status).toBe("completed")

    const march = await getPdtpManagementReport({ programId: PROGRAM, worksiteId: WS, scope: "all", filters: { monthFrom: 3, monthTo: 3 } })
    const april = await getPdtpManagementReport({ programId: PROGRAM, worksiteId: WS, scope: "all", filters: { monthFrom: 4, monthTo: 4 } })
    expect(march!.activities[0]).toMatchObject({ planned: 1, executed: 1 })
    expect(april!.activities[0]).toMatchObject({ planned: 1, executed: 0 })
    const indicators = await getPdtpComplianceIndicators(PROGRAM, WS)
    expect(indicators!.monthly[2]!.executed).toBe(1)
    expect(indicators!.monthly[3]!.executed).toBe(0)
  })

  it("una ocurrencia completada cuya ejecución enlazada no está aprobada no cuenta (D19)", async () => {
    await seedConfig({ connector: "campaigns" })
    await fact({ sourceType: "campana", sourceId: "camp-1", day: "03-02" })
    // Dato heredado: el enlace anterior completaba sin mirar la aprobación.
    await inMemoryDb.update(schema.pdtpScheduledInstances).set({ status: "completed", completedAt: nowIso() })
      .where(eq(schema.pdtpScheduledInstances.id, INST_A))
    expect(await marchIndicator()).toMatchObject({ planned: 2, executed: 0 })
  })
})
