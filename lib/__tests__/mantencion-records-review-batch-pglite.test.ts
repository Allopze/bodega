import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * «Marcar como revisados» en lote (Registros firmados) contra Postgres de verdad: las mismas reglas
 * que de a uno —permiso, alcance de faenas, un anulado no se revisa, uno ya revisado no se toca—,
 * una fila de bitácora por registro marcado, el tope del lote y la atomicidad.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { viewerFromSession } = await import("@/lib/services/mantencion/access")
const { markRecordReviewed, markRecordsReviewed } = await import("@/lib/services/mantencion/record-lifecycle")
const { MAX_REVIEW_BATCH, OWN_RECORD_REVIEW_MESSAGE } = await import("@/lib/mantencion/record-review-batch")

async function viewerOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return viewerFromSession({
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session)
}

/** Quien revisa pero sólo ve la faena de Biodiversa (el alcance de faenas del que mira). */
async function biodiversaReviewer() {
  const jefe = await viewerOf(IDS.jefe)
  return { ...jefe, permissions: ["mant:records:review", "mant:records:view_worksite"], worksiteIds: [IDS.wsBio], isGlobal: false }
}

const R = { bio1: "rb-bio1", bio2: "rb-bio2", cho1: "rb-cho1", voided: "rb-voided", done: "rb-done", observed: "rb-observed" } as const

async function insertRecord(id: string, folio: string, ws: { id: string; name: string }, vehicleId: string, extra: Partial<typeof schema.mantRecords.$inferInsert> = {}) {
  const now = new Date().toISOString()
  await testDb.insert(schema.mantRecords).values({
    id, folio, kind: "C", vehicleId,
    equipmentSnapshot: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: ws.name, unit: "km" },
    worksiteId: ws.id, outOfWorksite: false, reading: 10_000, unit: "km", workDate: daysAgo(1),
    registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio, executorName: "Javier Roa", signedAt: now, receivedAt: now,
    ...extra,
  })
}

const reviewOf = async (id: string) => (await testDb.select({ review: schema.mantRecords.review }).from(schema.mantRecords).where(eq(schema.mantRecords.id, id)))[0]!.review
const auditOf = (ids: string[]) => testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_record"), inArray(schema.auditLog.entityId, ids)))

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  const bio = { id: IDS.wsBio, name: "Biodiversa" }
  await insertRecord(R.bio1, "MC-BIO-9001", bio, IDS.truckBio)
  await insertRecord(R.bio2, "MC-BIO-9002", bio, IDS.truckBio)
  await insertRecord(R.cho1, "MC-CHO-9001", { id: IDS.wsCho, name: "Cholguán" }, IDS.truckCho, { registeredBy: IDS.mecCho, executorUserId: IDS.mecCho })
  await insertRecord(R.voided, "MC-BIO-9003", bio, IDS.truckBio, { status: "anulado" })
  await insertRecord(R.done, "MC-BIO-9004", bio, IDS.truckBio, { review: "revisado" })
  await insertRecord(R.observed, "MC-BIO-9005", bio, IDS.truckBio, { review: "observado" })
})

afterEach(async () => {
  // Cada prueba parte del mismo estado.
  await testDb.update(schema.mantRecords).set({ review: "pendiente" }).where(inArray(schema.mantRecords.id, [R.bio1, R.bio2, R.cho1]))
  await testDb.update(schema.mantRecords).set({ review: "observado" }).where(eq(schema.mantRecords.id, R.observed))
  await testDb.delete(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_record"))
})

describe("marcar como revisados en lote", () => {
  it("marca todos los que admiten la revisión (también el observado) y deja una fila de bitácora por registro, como de a uno", async () => {
    const result = await markRecordsReviewed({ recordIds: [R.bio1, R.bio2, R.cho1, R.observed], viewer: await viewerOf(IDS.jefe) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.marked).toBe(4)
    expect(result.data.skipped).toEqual([])
    expect(result.message).toBe("4 registros marcados como revisados")
    for (const id of [R.bio1, R.bio2, R.cho1, R.observed]) expect(await reviewOf(id)).toBe("revisado")

    const batchAudit = await auditOf([R.bio1, R.observed])
    expect(batchAudit).toHaveLength(2)
    // La misma fila que escribe la revisión individual.
    await markRecordReviewed({ recordId: R.bio2, viewer: await viewerOf(IDS.jefe) })
    const single = (await auditOf([R.bio2]))[0]!
    const fromBatch = batchAudit.find((row) => row.entityId === R.bio1)!
    expect({ action: fromBatch.action, userId: fromBatch.userId, newState: fromBatch.newState, oldState: fromBatch.oldState, worksiteId: fromBatch.worksiteId })
      .toEqual({ action: single.action, userId: single.userId, newState: single.newState, oldState: single.oldState, worksiteId: single.worksiteId })
    expect(batchAudit.find((row) => row.entityId === R.observed)!.oldState).toBe(JSON.stringify({ review: "observado" }))
  })

  it("un registro anulado o ya revisado se salta con su motivo y no aborta el lote", async () => {
    const result = await markRecordsReviewed({ recordIds: [R.bio1, R.voided, R.done, R.bio2], viewer: await viewerOf(IDS.jefe) })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.marked).toBe(2)
    expect(result.data.markedIds.sort()).toEqual([R.bio1, R.bio2])
    expect(result.data.skipped.map((item) => [item.recordId, item.reason]).sort()).toEqual([[R.done, "ya_revisado"], [R.voided, "anulado"]])
    expect(result.data.skipped.find((item) => item.recordId === R.voided)!.message).toBe("El registro MC-BIO-9003 está anulado.")
    expect(result.message).toBe("2 registros marcados como revisados; 1 ya estaba revisado; 1 está anulado")
    // El anulado sigue anulado y sin tocar; sólo los marcados dejan bitácora.
    expect((await testDb.select({ status: schema.mantRecords.status }).from(schema.mantRecords).where(eq(schema.mantRecords.id, R.voided)))[0]!.status).toBe("anulado")
    expect(await auditOf([R.voided, R.done])).toHaveLength(0)
    expect(await auditOf([R.bio1, R.bio2])).toHaveLength(2)
  })

  it("respeta el alcance de faenas: lo de otra faena es «no encontrado» y no se toca", async () => {
    const result = await markRecordsReviewed({ recordIds: [R.bio1, R.cho1, "no-existe"], viewer: await biodiversaReviewer() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.markedIds).toEqual([R.bio1])
    expect(result.data.skipped.map((item) => [item.recordId, item.reason]).sort()).toEqual([["no-existe", "no_encontrado"], [R.cho1, "no_encontrado"]])
    expect(result.data.skipped.every((item) => item.message === "No encontramos ese registro.")).toBe(true)
    expect(await reviewOf(R.cho1)).toBe("pendiente")
    expect(await auditOf([R.cho1])).toHaveLength(0)
  })

  it("sin el permiso de revisar no se marca nada", async () => {
    // La supervisión de faena ya no está aquí: revisa desde el 2026-11-26 (ver «la supervisión revisa …»).
    for (const userId of [IDS.mecBio, IDS.plain]) {
      const result = await markRecordsReviewed({ recordIds: [R.bio1], viewer: await viewerOf(userId) })
      expect(result).toEqual({ ok: false, message: "No tienes permiso para marcar registros como revisados." })
    }
    expect(await reviewOf(R.bio1)).toBe("pendiente")
  })

  it("la supervisión revisa los registros de SU faena y no los de otra", async () => {
    // `supervisor_mantencion` recibe `mant:records:review` por defecto: observar ya podía, cerrar como revisado no.
    const supervisor = await viewerOf(IDS.supBio)
    expect(supervisor.permissions).toContain("mant:records:review")
    const result = await markRecordsReviewed({ recordIds: [R.bio1, R.cho1], viewer: supervisor })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.markedIds).toEqual([R.bio1])
    expect(result.data.skipped.map((item) => [item.recordId, item.reason])).toEqual([[R.cho1, "no_encontrado"]])
    expect(await reviewOf(R.bio1)).toBe("revisado")
    expect(await reviewOf(R.cho1)).toBe("pendiente")
  })

  it("nadie revisa lo que firmó o ejecutó: ni de a uno ni en lote, jefatura o supervisión", async () => {
    // El supervisor firma un registro y otro lo ejecuta (la correctiva de un mecánico que él acompañó).
    await insertRecord("rb-sup-firmado", "MC-BIO-9101", { id: IDS.wsBio, name: "Biodiversa" }, IDS.truckBio, { registeredBy: IDS.supBio, executorUserId: IDS.supBio })
    await insertRecord("rb-sup-ejecutado", "MC-BIO-9102", { id: IDS.wsBio, name: "Biodiversa" }, IDS.truckBio, { registeredBy: IDS.mecBio, executorKind: "otro_mecanico", executorUserId: IDS.supBio })
    await insertRecord("rb-jefe-firmado", "MC-BIO-9103", { id: IDS.wsBio, name: "Biodiversa" }, IDS.truckBio, { registeredBy: IDS.jefe, executorUserId: IDS.jefe })
    const own = ["rb-sup-firmado", "rb-sup-ejecutado", "rb-jefe-firmado"]
    try {
      const supervisor = await viewerOf(IDS.supBio)
      const jefe = await viewerOf(IDS.jefe)

      // De a uno.
      for (const id of ["rb-sup-firmado", "rb-sup-ejecutado"]) {
        expect(await markRecordReviewed({ recordId: id, viewer: supervisor })).toEqual({ ok: false, message: OWN_RECORD_REVIEW_MESSAGE })
      }
      expect(await markRecordReviewed({ recordId: "rb-jefe-firmado", viewer: jefe })).toEqual({ ok: false, message: OWN_RECORD_REVIEW_MESSAGE })

      // En lote: se salta con su motivo y no aborta el resto.
      const batch = await markRecordsReviewed({ recordIds: ["rb-sup-firmado", "rb-sup-ejecutado", R.bio1], viewer: supervisor })
      expect(batch.ok).toBe(true)
      if (batch.ok) {
        expect(batch.data.markedIds).toEqual([R.bio1])
        expect(batch.data.skipped.map((item) => [item.recordId, item.reason]).sort()).toEqual([["rb-sup-ejecutado", "propio"], ["rb-sup-firmado", "propio"]])
        expect(batch.message).toBe("1 registro marcado como revisado; 2 los firmaste o ejecutaste tú")
      }
      for (const id of own) expect(await reviewOf(id)).toBe("pendiente")
      expect(await auditOf(own)).toHaveLength(0)

      // Otra persona sí los revisa: el jefe los del supervisor y el supervisor el del jefe.
      expect(await markRecordReviewed({ recordId: "rb-sup-firmado", viewer: jefe })).toMatchObject({ ok: true })
      expect(await markRecordReviewed({ recordId: "rb-jefe-firmado", viewer: supervisor })).toMatchObject({ ok: true })
      expect(await reviewOf("rb-sup-firmado")).toBe("revisado")
      expect(await reviewOf("rb-jefe-firmado")).toBe("revisado")
    } finally {
      await testDb.delete(schema.auditLog).where(inArray(schema.auditLog.entityId, own))
      await testDb.delete(schema.mantRecords).where(inArray(schema.mantRecords.id, own))
    }
  })

  it("el tope es de 200 por lote: uno más se rechaza entero, sin marcar ninguno", async () => {
    const viewer = await viewerOf(IDS.jefe)
    const tooMany = [R.bio1, ...Array.from({ length: MAX_REVIEW_BATCH }, (_, index) => `x-${index}`)]
    const rejected = await markRecordsReviewed({ recordIds: tooMany, viewer })
    expect(rejected).toEqual({ ok: false, message: `Elige hasta ${MAX_REVIEW_BATCH} registros por vez.` })
    expect(await reviewOf(R.bio1)).toBe("pendiente")

    // Exactamente 200 (la mayoría inexistentes) sí se procesa, y los repetidos cuentan una vez.
    const atLimit = [R.bio1, R.bio1, ...Array.from({ length: MAX_REVIEW_BATCH - 1 }, (_, index) => `x-${index}`)]
    const accepted = await markRecordsReviewed({ recordIds: atLimit, viewer })
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.data.marked).toBe(1)
  })

  it("sin ningún id no hace nada", async () => {
    expect(await markRecordsReviewed({ recordIds: [], viewer: await viewerOf(IDS.jefe) })).toEqual({ ok: false, message: "Elige al menos un registro." })
  })

  it("repetir el lote no vuelve a marcar ni a auditar: ahora todos ya estaban revisados", async () => {
    const viewer = await viewerOf(IDS.jefe)
    await markRecordsReviewed({ recordIds: [R.bio1, R.bio2], viewer })
    const again = await markRecordsReviewed({ recordIds: [R.bio1, R.bio2], viewer })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.data.marked).toBe(0)
    expect(again.message).toBe("No se marcó ninguno: 2 ya estaban revisados")
    expect(await auditOf([R.bio1, R.bio2])).toHaveLength(2)
  })
})
