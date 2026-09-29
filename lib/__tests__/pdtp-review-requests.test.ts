/**
 * PRV-05 / PRV-12 (auditoría de production readiness 2026-09-28): cancelar una
 * obligación y anular una ejecución aprobada pasan por una solicitud que
 * revisa otra persona. Contra Postgres real (PGlite) para que los CHECK y el
 * índice parcial participen.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedPdtpEvidenceUpload } from "@/lib/testing/pdtp-evidence-upload-fixture"
import * as schema from "@/db/schema"

process.env.STORAGE_PATH = path.join(tmpdir(), `pdtp-review-requests-${Date.now()}-${Math.random().toString(36).slice(2)}`)
mkdirSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence"), { recursive: true })
writeFileSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence", "acta.pdf"), "%PDF-1.4")
const EVIDENCE = "storage/pdtp-evidence/acta.pdf"

const pg = new PGlite()
const tdb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof tdb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = tdb
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const YEAR = 2024
const WS = "ws-rr"
const A = "u-pide"
const B = "u-revisa"
let programId = ""
let activityId = ""

beforeEach(async () => {
  await tdb.delete(schema.pdtpReviewRequests)
  await tdb.delete(schema.auditLog)
  await tdb.delete(schema.pdtpChangeLog)
  await tdb.delete(schema.pdtpExecutions)
  await tdb.delete(schema.pdtpObligations)
  await tdb.delete(schema.pdtpPeriodClosures)
  await tdb.delete(schema.pdtpActivitySchedule)
  await tdb.delete(schema.pdtpSheetActivities)
  await tdb.delete(schema.pdtpActivities)
  await tdb.delete(schema.pdtpPrograms)
  await tdb.delete(schema.pdtpResponsibleCatalog)
  await tdb.delete(schema.pdtpEvidenceUploads)
  await tdb.delete(schema.worksites)
  await tdb.delete(schema.users)
  await tdb.insert(schema.users).values([
    { id: A, name: "Pide", email: "pide@rr.test", hashedPassword: "x", isActive: true },
    { id: B, name: "Revisa", email: "revisa@rr.test", hashedPassword: "x", isActive: true },
  ])
  await tdb.insert(schema.pdtpResponsibleCatalog).values([{ slug: "prevencionista", displayName: "Prevencionista", kind: "role" }])
  await tdb.insert(schema.worksites).values([{ id: WS, name: "Faena RR", code: "RR1", isActive: true }])
  await seedPdtpEvidenceUpload(tdb, { path: EVIDENCE, worksiteId: WS, userId: A })

  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year: YEAR, title: "Programa RR", userId: A })
  programId = program.id
  const activity = await addPdtpActivity({
    programId, activity: "Charla mensual", program: "Guía", responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista", sheetCodes: [], scheduleMode: "on_demand",
  }, A)
  activityId = activity.id
  await tdb.insert(schema.pdtpActivitySchedule).values({ id: `${activityId}-s-3-1`, activityId, year: YEAR, month: 3, week: 1, plannedQuantity: 1, sourceColumn: "test" })
  await tdb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, programId))
})

async function seedObligation(id = "obl-1") {
  const now = new Date().toISOString()
  await tdb.insert(schema.pdtpObligations).values({
    id, programId, activityId, worksiteId: WS, mode: "on_demand", status: "overdue",
    dueAt: `${YEAR}-04-10T15:00:00.000Z`, idempotencyKey: `idem-${id}`, origin: "manual",
    manualReason: "Obligación abierta a mano para la prueba.", createdAt: now, updatedAt: now,
  })
  return id
}

describe("cancelación de obligación (PRV-05)", () => {
  it("pedirla no cancela nada; la cancela la aprobación de otra persona", async () => {
    const { requestPdtpObligationCancellation, reviewPdtpReviewRequest } = await import("@/lib/services/pdtp/review-requests")
    const obligationId = await seedObligation()
    const request = await requestPdtpObligationCancellation({ targetId: obligationId, reason: "El incidente se reclasificó como daño material." }, A, "all")
    expect(request.status).toBe("pending_review")
    const [still] = await tdb.select().from(schema.pdtpObligations).where(eq(schema.pdtpObligations.id, obligationId))
    expect(still!.status).toBe("overdue")

    await expect(reviewPdtpReviewRequest({ requestId: request.id, decision: "approve" }, A, "all")).rejects.toThrow(/propia/)
    await expect(reviewPdtpReviewRequest({ requestId: request.id, decision: "approve" }, B, "all")).resolves.toMatchObject({ status: "approved" })
    const [cancelled] = await tdb.select().from(schema.pdtpObligations).where(eq(schema.pdtpObligations.id, obligationId))
    expect(cancelled).toMatchObject({ status: "cancelled", cancelledByUserId: B })
  })

  it("no admite dos solicitudes en revisión para la misma obligación, y rechazar exige motivo", async () => {
    const { requestPdtpObligationCancellation, reviewPdtpReviewRequest } = await import("@/lib/services/pdtp/review-requests")
    const obligationId = await seedObligation()
    const request = await requestPdtpObligationCancellation({ targetId: obligationId, reason: "El incidente se reclasificó como daño material." }, A, "all")
    await expect(requestPdtpObligationCancellation({ targetId: obligationId, reason: "Otro motivo cualquiera, largo." }, B, "all")).rejects.toThrow(/en revisión/)
    await expect(reviewPdtpReviewRequest({ requestId: request.id, decision: "reject" }, B, "all")).rejects.toThrow(/motivo/)
    await expect(reviewPdtpReviewRequest({ requestId: request.id, decision: "reject", reason: "El incidente sí fue un accidente del trabajo." }, B, "all"))
      .resolves.toMatchObject({ status: "rejected" })
    const [kept] = await tdb.select().from(schema.pdtpObligations).where(eq(schema.pdtpObligations.id, obligationId))
    expect(kept!.status).toBe("overdue")
  })

  it("no se pide sobre un mes ya cerrado", async () => {
    const { requestPdtpObligationCancellation } = await import("@/lib/services/pdtp/review-requests")
    const obligationId = await seedObligation()
    const now = new Date().toISOString()
    await tdb.insert(schema.pdtpPeriodClosures).values({
      id: "clo-abr", programId, worksiteId: WS, year: YEAR, month: 4, status: "closed",
      closedByUserId: B, closedAt: now, closeReason: "Cierre de abril para la prueba.",
      snapshotJson: {}, digest: "d".repeat(64), createdAt: now, updatedAt: now,
    })
    await expect(requestPdtpObligationCancellation({ targetId: obligationId, reason: "El incidente se reclasificó como daño material." }, A, "all"))
      .rejects.toThrow(/cerrad/)
  })
})

describe("anulación de una ejecución aprobada (PRV-12)", () => {
  async function approvedExecution() {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/pdtp/executions")
    const execution = await markPdtpExecution(
      { activityId, worksiteId: WS, year: YEAR, month: 3, week: 1, executedQuantity: 1, evidenceText: "Charla hecha", evidenceUrl: EVIDENCE },
      A, "all", { canActForOthers: true },
    )
    return approvePdtpExecution(execution.id, B, "all")
  }

  it("la anulación aprobada por otra persona saca la ejecución del cumplimiento", async () => {
    const { requestPdtpExecutionAnnulment, reviewPdtpReviewRequest } = await import("@/lib/services/pdtp/review-requests")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const execution = await approvedExecution()
    expect((await getPdtpComplianceIndicators(programId, WS))!.monthly[2]!.executed).toBe(1)

    const request = await requestPdtpExecutionAnnulment({ targetId: execution.id, reason: "La charla se registró en la faena equivocada." }, B, "all")
    expect((await getPdtpComplianceIndicators(programId, WS))!.monthly[2]!.executed).toBe(1)
    await expect(reviewPdtpReviewRequest({ requestId: request.id, decision: "approve" }, B, "all")).rejects.toThrow(/propia/)
    await reviewPdtpReviewRequest({ requestId: request.id, decision: "approve" }, A, "all")

    const [annulled] = await tdb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, execution.id))
    expect(annulled!.status).toBe("rejected")
    expect(annulled!.rejectionReason).toMatch(/Aprobación anulada/)
    expect((await getPdtpComplianceIndicators(programId, WS))!.monthly[2]!.executed).toBe(0)
  })

  it("una ejecución que viene de otro módulo no se anula aquí", async () => {
    const { requestPdtpExecutionAnnulment } = await import("@/lib/services/pdtp/review-requests")
    const execution = await approvedExecution()
    await tdb.update(schema.pdtpExecutions).set({ origin: "integration" }).where(eq(schema.pdtpExecutions.id, execution.id))
    await expect(requestPdtpExecutionAnnulment({ targetId: execution.id, reason: "No corresponde a esta faena." }, B, "all"))
      .rejects.toThrow(/registro de origen/)
  })

  it("sólo se anula lo aprobado", async () => {
    const { requestPdtpExecutionAnnulment } = await import("@/lib/services/pdtp/review-requests")
    const { markPdtpExecution } = await import("@/lib/services/pdtp/executions")
    const submitted = await markPdtpExecution(
      { activityId, worksiteId: WS, year: YEAR, month: 3, week: 1, executedQuantity: 1, evidenceText: "Charla", evidenceUrl: EVIDENCE },
      A, "all", { canActForOthers: true },
    )
    await expect(requestPdtpExecutionAnnulment({ targetId: submitted.id, reason: "Todavía no se aprobó nada." }, B, "all")).rejects.toThrow(/aprobada/)
  })
})
