/**
 * lib/__tests__/pdtp-scheduled-instance-outcome-review.test.ts
 *
 * PREV-C07 sobre ocurrencias programadas (tanda C07/M02-B). Hasta aquí el
 * "No aplica" y la cancelación de una ocurrencia la sacaban del denominador en
 * el acto, con un solo actor. Ahora siguen la regla del N/A de celda (T2, D8):
 *
 * - nacen como solicitud `pending_review` y la ocurrencia sigue contando;
 * - las aprueba o rechaza otra persona (quien declaró no revisa);
 * - el "No aplica" no se declara sobre una fecha futura (fecha de Chile);
 * - motivo ≥ 10 caracteres, traza en `pdtp_change_log`;
 * - quien la pidió la retira; nadie más;
 * - mes cerrado y ventana de la versión se comprueban al pedir y al revisar;
 * - un mes con solicitudes pendientes no se cierra;
 * - una ejecución aprobada que cumple la ocurrencia retira la solicitud.
 *
 * Programa del año anterior: todas sus fechas ya ocurrieron, así la prueba no
 * depende del día en que corre.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts, todayInChile } from "@/lib/utils"

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

const { recordPdtpScheduledInstanceOutcome } = await import("@/lib/services/pdtp/scheduled-execution")
const {
  reviewPdtpScheduledInstanceOutcome,
  withdrawPdtpScheduledInstanceOutcomeRequest,
  listPendingPdtpScheduledInstanceOutcomes,
} = await import("@/lib/services/pdtp/scheduled-outcome-review")
const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
const { recordPdtpFulfillmentEvent } = await import("@/lib/services/pdtp/fulfillment")
const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")

const Y = chileDateParts().year - 1
const PROGRAM = "pdtp-sor"
const ACT = "pdtp-sor-act"
const ACT_N = 43
const WS = "ws-sor"
const WS_OTHER = "ws-sor-otra"
const DECLARER = "user-sor-declara"
const REVIEWER = "user-sor-revisa"
const THIRD = "user-sor-tercero"
const INST_A = "inst-sor-a" // 02-03
const INST_B = "inst-sor-b" // 20-03
const REASON = "La faena estuvo detenida todo el mes por mantención"
const nowIso = () => new Date().toISOString()

async function seedInstance(id: string, scheduledFor: string, overrides: Partial<typeof schema.pdtpScheduledInstances.$inferInsert> = {}) {
  const now = nowIso()
  await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
    id, programId: PROGRAM, activityId: ACT, worksiteId: WS, scheduledFor,
    isoWeekYear: Number(scheduledFor.slice(0, 4)), isoWeek: 10, plannedQuantity: 1, status: "pending",
    idempotencyKey: `pdtp-scheduled:${ACT}:${WS}:${scheduledFor}`, sourceMetadataJson: {},
    createdAt: now, updatedAt: now, ...overrides,
  })
}

async function closeMonth(month: number) {
  const now = nowIso()
  await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
    id: `closure-sor-${month}`, programId: PROGRAM, worksiteId: WS, year: Y, month, status: "closed",
    snapshotJson: {}, digest: "a".repeat(64), closedByUserId: REVIEWER, closedAt: nowIso(), closeReason: "Cierre de prueba del mes",
    createdAt: now, updatedAt: now,
  })
}

async function instance(id: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpScheduledInstances).where(eq(schema.pdtpScheduledInstances.id, id))
  return row!
}

async function requestsOf(instanceId: string) {
  return inMemoryDb.select().from(schema.pdtpScheduledInstanceOutcomeRequests)
    .where(eq(schema.pdtpScheduledInstanceOutcomeRequests.instanceId, instanceId))
}

async function marchPlanned() {
  const indicators = await getPdtpComplianceIndicators(PROGRAM, WS)
  return indicators!.monthly[2]!.planned
}

const declareNa = (instanceId = INST_A, userId = DECLARER, reason = REASON) =>
  recordPdtpScheduledInstanceOutcome({ instanceId, action: "not_applicable", userId, reason, scope: "all" })

async function pendingRequestId(instanceId = INST_A): Promise<string> {
  const [row] = await inMemoryDb.select({ id: schema.pdtpScheduledInstanceOutcomeRequests.id })
    .from(schema.pdtpScheduledInstanceOutcomeRequests)
    .where(and(
      eq(schema.pdtpScheduledInstanceOutcomeRequests.instanceId, instanceId),
      eq(schema.pdtpScheduledInstanceOutcomeRequests.status, "pending_review"),
    ))
  return row!.id
}

beforeEach(async () => {
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
  await inMemoryDb.insert(schema.users).values([DECLARER, REVIEWER, THIRD].map((id) => ({ id, name: id, email: `${id}@test`, hashedPassword: "x" })))
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS, name: "Faena revisión", code: "FR", isActive: true },
    { id: WS_OTHER, name: "Faena otra", code: "FX", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM, version: 1, year: Y, title: `PDTP ${Y} revisión`, status: "active", appliesToAllWorksites: true,
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
  await seedInstance(INST_A, `${Y}-03-02`)
  await seedInstance(INST_B, `${Y}-03-20`)
})

describe("'No aplica' de una ocurrencia nace en revisión", () => {
  it("la ocurrencia sigue pendiente y sigue contando en el denominador", async () => {
    expect(await marchPlanned()).toBe(2)
    const result = await declareNa()
    expect(result.status).toBe("pending")
    expect(result.outcomeRequestId).toBeTruthy()
    expect((await instance(INST_A)).status).toBe("pending")
    const [request] = await requestsOf(INST_A)
    expect(request).toMatchObject({ outcome: "not_applicable", status: "pending_review", requestedByUserId: DECLARER, reason: REASON })
    expect(await marchPlanned()).toBe(2)
  })

  it("aprobado por otra persona, recién ahí sale del denominador", async () => {
    await declareNa()
    const reviewed = await reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(), decision: "approve" }, REVIEWER, "all")
    expect(reviewed.status).toBe("approved")
    const row = await instance(INST_A)
    expect(row.status).toBe("not_applicable")
    expect(row.notApplicableReason).toBe(REASON)
    expect(row.sourceMetadataJson).toMatchObject({ outcomeRecordedByUserId: DECLARER, outcomeReviewedByUserId: REVIEWER })
    expect(await marchPlanned()).toBe(1)
  })

  it("quien declaró no revisa su propia solicitud", async () => {
    await declareNa()
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(), decision: "approve" }, DECLARER, "all"))
      .rejects.toThrow(/otra persona/)
    expect((await instance(INST_A)).status).toBe("pending")
  })

  it("el revisor necesita alcance sobre la faena", async () => {
    await declareNa()
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(), decision: "approve" }, REVIEWER, [WS_OTHER]))
      .rejects.toThrow()
    expect((await instance(INST_A)).status).toBe("pending")
  })

  it("rechazar exige motivo, deja la ocurrencia exigible y libre para otra solicitud", async () => {
    await declareNa()
    const requestId = await pendingRequestId()
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId, decision: "reject", reason: "no" }, REVIEWER, "all")).rejects.toThrow()
    const rejected = await reviewPdtpScheduledInstanceOutcome({ requestId, decision: "reject", reason: "La faena sí operó esa semana" }, REVIEWER, "all")
    expect(rejected).toMatchObject({ status: "rejected", reviewedByUserId: REVIEWER, reviewReason: "La faena sí operó esa semana" })
    expect((await instance(INST_A)).status).toBe("pending")
    expect(await marchPlanned()).toBe(2)
    await declareNa(INST_A, DECLARER, "Segunda solicitud con más detalle del motivo")
    expect((await requestsOf(INST_A)).map((row) => row.status).sort()).toEqual(["pending_review", "rejected"])
  })

  it("una solicitud ya revisada no se revisa de nuevo", async () => {
    await declareNa()
    const requestId = await pendingRequestId()
    await reviewPdtpScheduledInstanceOutcome({ requestId, decision: "approve" }, REVIEWER, "all")
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId, decision: "reject", reason: "Cambio de opinión del revisor" }, THIRD, "all"))
      .rejects.toThrow(/no está pendiente/)
  })

  it("exige un motivo de al menos 10 caracteres", async () => {
    await expect(declareNa(INST_A, DECLARER, "Detenida")).rejects.toThrow(/al menos 10 caracteres/)
    expect(await requestsOf(INST_A)).toHaveLength(0)
  })

  it("no se declara sobre una ocurrencia futura (fecha de Chile)", async () => {
    const tomorrow = new Date(`${todayInChile()}T12:00:00.000Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const future = tomorrow.toISOString().slice(0, 10)
    await seedInstance("inst-sor-future", future)
    await expect(declareNa("inst-sor-future")).rejects.toThrow(/aún no ocurre/)
    expect(await requestsOf("inst-sor-future")).toHaveLength(0)
  })

  it("una segunda solicitud sobre la misma ocurrencia se rechaza; repetir la misma es idempotente", async () => {
    const first = await declareNa()
    const again = await declareNa()
    expect(again.outcomeRequestId).toBe(first.outcomeRequestId)
    await expect(recordPdtpScheduledInstanceOutcome({ instanceId: INST_A, action: "cancel", userId: THIRD, reason: "Duplicada con la del día 20", scope: "all" }))
      .rejects.toThrow(/pendiente de revisión/)
    expect(await requestsOf(INST_A)).toHaveLength(1)
  })

  it("deja traza en el control de cambios al pedir y al revisar", async () => {
    await declareNa()
    await reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(), decision: "approve" }, REVIEWER, "all")
    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, PROGRAM))
    expect(log.map((entry) => entry.section)).toEqual([`scheduled_instance:${ACT_N}`, `scheduled_instance:${ACT_N}`])
    expect(log.map((entry) => entry.changedByUserId).sort()).toEqual([DECLARER, REVIEWER].sort())
    expect(log.some((entry) => /en revisión/i.test(entry.note ?? ""))).toBe(true)
    expect(log.some((entry) => /aprobad/i.test(entry.note ?? ""))).toBe(true)
  })
})

describe("cancelar una ocurrencia sigue la misma revisión", () => {
  it("la cancelación queda pendiente y, aprobada, deja la ocurrencia cancelada", async () => {
    const result = await recordPdtpScheduledInstanceOutcome({ instanceId: INST_B, action: "cancel", userId: DECLARER, reason: "Duplicada con la ocurrencia del día 2", scope: "all" })
    expect(result.status).toBe("pending")
    expect(await marchPlanned()).toBe(2)
    await reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(INST_B), decision: "approve" }, REVIEWER, "all")
    const row = await instance(INST_B)
    expect(row).toMatchObject({ status: "cancelled", cancelledByUserId: DECLARER, cancellationReason: "Duplicada con la ocurrencia del día 2" })
    expect(await marchPlanned()).toBe(1)
  })
})

describe("retirar la solicitud", () => {
  it("quien la pidió la retira y la ocurrencia queda como estaba", async () => {
    await declareNa()
    const requestId = await pendingRequestId()
    const withdrawn = await withdrawPdtpScheduledInstanceOutcomeRequest({ requestId }, DECLARER, "all")
    expect(withdrawn).toMatchObject({ status: "withdrawn", withdrawnByUserId: DECLARER })
    expect((await instance(INST_A)).status).toBe("pending")
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId, decision: "approve" }, REVIEWER, "all")).rejects.toThrow(/no está pendiente/)
  })

  it("nadie más la retira", async () => {
    await declareNa()
    await expect(withdrawPdtpScheduledInstanceOutcomeRequest({ requestId: await pendingRequestId() }, REVIEWER, "all"))
      .rejects.toThrow(/quien la pidió/)
  })
})

describe("mes cerrado, ventana de la versión y cierre del mes", () => {
  it("no se pide sobre un mes cerrado", async () => {
    await closeMonth(3)
    await expect(declareNa()).rejects.toThrow(/cerrado/)
  })

  it("no se revisa si el mes se cerró entretanto", async () => {
    await declareNa()
    await closeMonth(3)
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(), decision: "approve" }, REVIEWER, "all"))
      .rejects.toThrow(/cerrado/)
  })

  it("un año cerrado formalmente no revisa", async () => {
    await declareNa()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed", yearClosedAt: nowIso() }).where(eq(schema.pdtpPrograms.id, PROGRAM))
    await expect(reviewPdtpScheduledInstanceOutcome({ requestId: await pendingRequestId(), decision: "approve" }, REVIEWER, "all"))
      .rejects.toThrow(/cerrado formalmente/)
  })

  it("un mes con solicitudes pendientes de sus ocurrencias no se cierra", async () => {
    await declareNa()
    await expect(closePdtpPeriod({ programId: PROGRAM, worksiteId: WS, year: Y, month: 3, reason: "Cierre mensual de marzo" }, REVIEWER, "all"))
      .rejects.toThrow(/en revisión/)
  })
})

describe("coherencia con la ejecución del libro", () => {
  it("una ejecución aprobada que cumple la ocurrencia retira la solicitud pendiente", async () => {
    const now = nowIso()
    await inMemoryDb.insert(schema.pdtpActivityExecutionConfigs).values({
      id: "cfg-sor", activityId: ACT, destinationConnectorKey: "inspections", completionPolicy: "source_completed",
      evidenceRequired: false, acceptedEvidenceKinds: [], createdAt: now, updatedAt: now,
    })
    await declareNa()
    await recordPdtpFulfillmentEvent({
      sourceType: "inspeccion", sourceId: "run-sor", worksiteId: WS, activityNumbers: [ACT_N],
      occurredAt: `${Y}-03-02T15:00:00.000Z`, autoApproveByUserId: THIRD,
    })
    expect((await instance(INST_A)).status).toBe("completed")
    const [request] = await requestsOf(INST_A)
    expect(request!.status).toBe("withdrawn")
    expect(request!.withdrawReason).toMatch(/ejecución aprobada/)
  })

  it("un 'no aplica' ya vigente antes de la revisión no cambia: sigue fuera del denominador y repetirlo es idempotente", async () => {
    await inMemoryDb.update(schema.pdtpScheduledInstances)
      .set({ status: "not_applicable", notApplicableReason: "Heredado sin revisión" })
      .where(eq(schema.pdtpScheduledInstances.id, INST_A))
    expect(await marchPlanned()).toBe(1)
    const again = await declareNa()
    expect(again.status).toBe("not_applicable")
    expect(await requestsOf(INST_A)).toHaveLength(0)
  })
})

describe("bandeja de revisión", () => {
  it("lista las pendientes dentro del alcance y del programa", async () => {
    await declareNa()
    await recordPdtpScheduledInstanceOutcome({ instanceId: INST_B, action: "cancel", userId: DECLARER, reason: "Duplicada con la ocurrencia del día 2", scope: "all" })
    const all = await listPendingPdtpScheduledInstanceOutcomes("all")
    expect(all.map((item) => [item.instanceId, item.outcome])).toEqual([[INST_A, "not_applicable"], [INST_B, "cancelled"]])
    expect(all[0]).toMatchObject({
      programId: PROGRAM, activityN: ACT_N, worksiteName: "Faena revisión", scheduledFor: `${Y}-03-02`,
      reason: REASON, requestedByUserId: DECLARER, requestedByName: DECLARER,
    })
    expect(await listPendingPdtpScheduledInstanceOutcomes([WS_OTHER])).toEqual([])
    expect(await listPendingPdtpScheduledInstanceOutcomes("all", { programId: "otro" })).toEqual([])
  })
})
