/**
 * PREV-B01-BACKFILL (T3). Antes del fix de B01, revocar la fuente saltaba las
 * ejecuciones aprobadas por una persona (`skippedApproved`) y el libro marcaba
 * el evento `revoked`: la actividad siguió cumplida con un registro anulado.
 * El script lista esos casos (reporte por defecto) y, con `--apply --actor`,
 * los revierte con la lógica corregida, sólo sobre esas ejecuciones.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
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

const { planPdtpRevokedApprovalsBackfill, applyPdtpRevokedApprovalsBackfill, PDTP_B01_BLIND_PERIOD_BEFORE } = await import("../revert-pdtp-revoked-approvals")
const { reconcilePdtpFulfillmentEvents } = await import("@/lib/services/pdtp/fulfillment")

const Y = chileDateParts().year
const PROGRAM = "pdtp-b01"
const ACT = "pdtp-b01-a-062"
const WS = "ws-b01"
const APPROVER = "user-b01-approver"
const ACTOR = "user-b01-jefatura"

async function seedApprovedExecution(input: { id: string; sourceId: string; month?: number; metadata?: Record<string, unknown>; status?: string; createdAt?: string; idempotencyKey?: string }) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: input.id, activityId: ACT, worksiteId: WS, year: Y, month: input.month ?? 3, week: 1, executedQuantity: 1,
    status: input.status ?? "approved", approvedByUserId: APPROVER, approvedAt: now, origin: "integration",
    sourceType: "epp", sourceId: input.sourceId, idempotencyKey: input.idempotencyKey ?? `pdtp-accredit:${ACT}:${WS}:epp:${input.sourceId}`,
    evidencePhotos: [], sourceMetadataJson: { sourceType: "epp", sourceId: input.sourceId, approvalMode: "manual", ...(input.metadata ?? {}) },
    createdAt: input.createdAt ?? now, updatedAt: now,
  })
}

/** El evento que dejó la revocación vieja: `revoked` con la aprobación saltada. */
async function seedOldRevocation(input: { sourceId: string; executionId: string; updatedAt?: string }) {
  const at = input.updatedAt ?? `${Y}-04-01T12:00:00.000Z`
  await inMemoryDb.insert(schema.pdtpFulfillmentEvents).values({
    id: `evt-revoked-${input.sourceId}`, sourceType: "epp", sourceId: input.sourceId, eventType: "revoked",
    worksiteId: WS, occurredAt: at, quantity: 0, evidenceRef: "Entrega anulada por error de talla",
    idempotencyKey: `pdtp-fulfillment:revoked:epp:${input.sourceId}`, status: "revoked", activityNumbers: [],
    resultJson: { revoked: [], skippedApproved: [{ activityId: ACT, executionId: input.executionId }] },
    attempts: 1, createdAt: at, updatedAt: at,
  })
}

async function execution(id: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, id))
  return row!
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpFulfillmentEventTargets)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([APPROVER, ACTOR].map((id) => ({ id, name: id, email: `${id}@test`, hashedPassword: "x", isActive: true })))
  await inMemoryDb.insert(schema.worksites).values({ id: WS, name: "Faena B01", code: "B01", isActive: true })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM, version: 1, year: Y, title: `PDTP ${Y}`, status: "active", appliesToAllWorksites: true,
    elaboratedByName: "X", elaboratedByTitle: "Y", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT, programId: PROGRAM, n: 62, activity: "Entrega de EPP", program: "EPP", responsibleSlugs: [], responsibleDisplay: "Bodega",
    scheduleMode: "triggered", scheduleClassificationStatus: "confirmed", sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
})

describe("revert-pdtp-revoked-approvals", () => {
  it("el reporte clasifica como revert una aprobación humana sobre un origen revocado y no escribe", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    const plan = await planPdtpRevokedApprovalsBackfill()
    expect(plan.counts.revert).toBe(1)
    expect(plan.rows[0]).toMatchObject({ executionId: "exec-1", classification: "revert", activityN: 62, approvedByUserId: APPROVER })
    expect(plan.blindPeriod.before).toBe(PDTP_B01_BLIND_PERIOD_BEFORE)
    expect((await execution("exec-1")).status).toBe("approved")
    expect(await inMemoryDb.select().from(schema.pdtpChangeLog)).toHaveLength(0)
  })

  it("apply revierte a borrador, deja traza y anota el evento sin tocar su updatedAt; una segunda corrida no hace nada", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    const [before] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents).where(eq(schema.pdtpFulfillmentEvents.id, "evt-revoked-entrega-1"))

    const result = await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect(result.reverted).toEqual([expect.objectContaining({ executionId: "exec-1" })])
    const row = await execution("exec-1")
    expect(row.status).toBe("draft")
    expect(row.sourceMetadataJson).toMatchObject({ previousApprovedByUserId: APPROVER, revokedBy: ACTOR })
    expect(String((row.sourceMetadataJson as Record<string, unknown>).revocationReason)).toMatch(/PREV-B01/)
    const log = await inMemoryDb.select().from(schema.pdtpChangeLog)
    expect(log.some((entry) => entry.changedByUserId === ACTOR && entry.section === "execution:exec-1")).toBe(true)

    const [after] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents).where(eq(schema.pdtpFulfillmentEvents.id, "evt-revoked-entrega-1"))
    expect(after!.updatedAt).toBe(before!.updatedAt)
    expect(after!.status).toBe("revoked")
    expect(after!.resultJson).toMatchObject({ skippedApproved: [{ executionId: "exec-1" }], backfillB01: { actorUserId: ACTOR } })

    const second = await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect(second.reverted).toEqual([])
    expect((await planPdtpRevokedApprovalsBackfill()).rows).toHaveLength(0)
  })

  it("no revierte si el origen se volvió a completar después de la revocación", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    await inMemoryDb.insert(schema.pdtpFulfillmentEvents).values({
      id: "evt-completed-entrega-1", sourceType: "epp", sourceId: "entrega-1", eventType: "completed", worksiteId: WS,
      occurredAt: `${Y}-04-05T12:00:00.000Z`, quantity: 1, idempotencyKey: "pdtp-fulfillment:completed:epp:entrega-1",
      status: "accredited", activityNumbers: [62], resultJson: {}, attempts: 2,
      createdAt: `${Y}-03-01T12:00:00.000Z`, updatedAt: `${Y}-04-05T12:00:00.000Z`,
    })
    const plan = await planPdtpRevokedApprovalsBackfill()
    expect(plan.rows[0]?.classification).toBe("source_recompleted")
    await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect((await execution("exec-1")).status).toBe("approved")
  })

  it("omite y lista un mes cerrado (D17)", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1", month: 3 })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
      id: "closure-b01", programId: PROGRAM, worksiteId: WS, year: Y, month: 3, status: "closed", snapshotJson: {},
      digest: "a".repeat(64), closedByUserId: ACTOR, closedAt: now, closeReason: "Cierre de marzo", createdAt: now, updatedAt: now,
    })
    const plan = await planPdtpRevokedApprovalsBackfill()
    expect(plan.rows[0]?.classification).toBe("closed_period")
    const result = await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect(result.reverted).toEqual([])
    expect((await execution("exec-1")).status).toBe("approved")
  })

  it("omite y lista un programa cerrado (D17)", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "closed" }).where(eq(schema.pdtpPrograms.id, PROGRAM))
    expect((await planPdtpRevokedApprovalsBackfill()).rows[0]?.classification).toBe("closed_program")
    await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect((await execution("exec-1")).status).toBe("approved")
  })

  it("no toca una fila agregada con varias fuentes", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1", metadata: { accreditedKeys: [`pdtp-accredit:${ACT}:${WS}:epp:entrega-1`, `pdtp-accredit:${ACT}:${WS}:epp:entrega-2`] } })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    expect((await planPdtpRevokedApprovalsBackfill()).rows[0]?.classification).toBe("aggregated_manual")
    await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect((await execution("exec-1")).status).toBe("approved")
  })

  it("si la ejecución cambió entre el reporte y apply, la omite", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    expect((await planPdtpRevokedApprovalsBackfill()).rows[0]?.classification).toBe("revert")
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "rejected" }).where(eq(schema.pdtpExecutions.id, "exec-1"))
    const result = await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect(result.reverted).toEqual([])
    expect((await execution("exec-1")).status).toBe("rejected")
  })

  it("apply exige un actor existente antes de escribir nada", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    await expect(applyPdtpRevokedApprovalsBackfill({ actorUserId: "no-existe" })).rejects.toThrow(/actor/i)
    await expect(applyPdtpRevokedApprovalsBackfill({ actorUserId: "" })).rejects.toThrow(/actor/i)
    expect((await execution("exec-1")).status).toBe("approved")
  })

  it("no revierte las otras filas del mismo origen que ya estaban revertidas", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    // Otra fila del mismo origen (histórica, de otra actividad-clave) ya revertida.
    await seedApprovedExecution({ id: "exec-0", sourceId: "entrega-1", status: "draft", idempotencyKey: "otra-clave", metadata: { revokedAt: "2026-04-01T12:00:00.000Z", revocationReason: "Motivo original" } })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1" })
    await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    expect((await execution("exec-0")).sourceMetadataJson).toMatchObject({ revocationReason: "Motivo original" })
  })

  it("declara el período ciego y lista para revisión las aprobaciones de integración anteriores al libro", async () => {
    await seedApprovedExecution({ id: "exec-old", sourceId: "entrega-vieja", createdAt: "2026-08-20T12:00:00.000Z" })
    const plan = await planPdtpRevokedApprovalsBackfill()
    expect(plan.rows).toHaveLength(0)
    expect(plan.blindPeriod.note).toMatch(/03-09-2026/)
    expect(plan.blindPeriodCandidates).toEqual([expect.objectContaining({ executionId: "exec-old" })])
  })

  it("anotar el evento no cambia la última intención que ve el reconciliador", async () => {
    await seedApprovedExecution({ id: "exec-1", sourceId: "entrega-1" })
    await seedOldRevocation({ sourceId: "entrega-1", executionId: "exec-1", updatedAt: `${Y}-04-01T12:00:00.000Z` })
    // El origen se marcó hecho otra vez después de la revocación y ese intento quedó en error.
    await inMemoryDb.insert(schema.pdtpFulfillmentEvents).values({
      id: "evt-completed-retry", sourceType: "epp", sourceId: "entrega-1", eventType: "completed", worksiteId: WS,
      occurredAt: `${Y}-04-05T12:00:00.000Z`, quantity: 1, idempotencyKey: "pdtp-fulfillment:completed:epp:entrega-1",
      status: "error", lastError: "falla transitoria", activityNumbers: [62], resultJson: {}, attempts: 1,
      createdAt: `${Y}-03-01T12:00:00.000Z`, updatedAt: `${Y}-04-05T12:00:00.000Z`,
    })
    await applyPdtpRevokedApprovalsBackfill({ actorUserId: ACTOR })
    await reconcilePdtpFulfillmentEvents()
    const [completed] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents).where(eq(schema.pdtpFulfillmentEvents.id, "evt-completed-retry"))
    expect(completed?.status).not.toBe("rejected")
  })
})
