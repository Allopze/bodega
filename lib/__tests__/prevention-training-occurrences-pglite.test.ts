import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const USER_ID = "training-occ-user"
const WORKSITE_ID = "training-occ-worksite"
const ACCESS = {
  userId: USER_ID,
  scope: { mode: "all", ids: [] } as WorksiteScope,
  permissions: ["prevention:training:view", "prevention:training:record"],
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionTrainingOccurrenceEvidence)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista Test",
    email: "training-occ@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID,
    name: "Faena Capacitación",
    code: "TRAINING-OCC",
    isActive: true,
  })
})

describe("ocurrencias de capacitación", () => {
  it("crea el cronograma idempotente, exige evidencia y conserva las correcciones", async () => {
    const {
      ensurePreventionTrainingOccurrencesForWorksiteTx,
      listTrainingOccurrences,
      recordTrainingOccurrenceStatus,
    } = await import("@/lib/services/prevention-training-occurrences")

    // 94 = 52 (Task 5) + 42 de la Task 8 (N°16, 37, 51, 57, 59, 60).
    await expect(ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, WORKSITE_ID)).resolves.toBe(94)
    await expect(ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, WORKSITE_ID)).resolves.toBe(0)

    const rows = await listTrainingOccurrences(ACCESS)
    expect(rows).toHaveLength(94)
    const target = rows.find((row) => row.code === "CAP-02" && row.slotKey === "m09-w4")
    expect(target).toMatchObject({ status: "pending", scheduledMonth: 9, scheduledWeek: 4, version: 1 })
    if (!target) throw new Error("No se encontró la ocurrencia de prueba.")

    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "completed",
    }, ACCESS)).rejects.toThrow(/evidencia/i)

    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values({
      id: "training-occ-evidence-1",
      occurrenceId: target.id,
      fileName: "acta-extintores.pdf",
      storagePath: "storage/prevention-training-evidence/test-acta-extintores.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 128,
      sha256: "a".repeat(64),
      state: "active",
      uploadedByUserId: USER_ID,
    })

    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "completed",
      observation: "Actividad ejecutada en reunión mensual.",
    }, ACCESS)).resolves.toMatchObject({ status: "completed", version: 2 })

    const [completed] = await inMemoryDb.select().from(schema.preventionTrainingOccurrences)
      .where(eq(schema.preventionTrainingOccurrences.id, target.id))
    expect(completed).toMatchObject({ status: "completed", version: 2, completedByUserId: USER_ID })

    const [fulfillment] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(and(
        eq(schema.pdtpFulfillmentEvents.sourceType, "capacitacion_ocurrencia"),
        eq(schema.pdtpFulfillmentEvents.sourceId, target.id),
        eq(schema.pdtpFulfillmentEvents.eventType, "completed"),
      ))
    expect(fulfillment).toMatchObject({
      activityNumbers: [54],
      periodOverrideJson: { year: 2026, month: 9, week: 4 },
    })

    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: 2,
      status: "not_completed",
      observation: "Se reprogramará por cambio de turno.",
    }, ACCESS)).resolves.toMatchObject({ status: "not_completed", version: 3 })

    const [evidence] = await inMemoryDb.select().from(schema.preventionTrainingOccurrenceEvidence)
      .where(eq(schema.preventionTrainingOccurrenceEvidence.id, "training-occ-evidence-1"))
    expect(evidence).toMatchObject({ state: "annulled", fileName: "acta-extintores.pdf" })

    /* Antes acá había dos aserciones: una sobre `prevention_training_history` y
     * otra sobre `audit_log`, con el mismo largo. Eran la misma traza escrita
     * dos veces; la tabla por módulo se retiró y queda la compartida. */
    expect((await inMemoryDb.select().from(schema.auditLog)).filter((row) => row.entityId === target.id)).toHaveLength(2)
    expect((await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)).filter((row) => row.sourceId === target.id)).toHaveLength(2)

    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: 3,
      status: "pending",
    }, ACCESS)).rejects.toThrow()

    await inMemoryDb.update(schema.worksites).set({ isActive: false }).where(eq(schema.worksites.id, WORKSITE_ID))
    expect(await listTrainingOccurrences(ACCESS)).toEqual([])
    expect((await listTrainingOccurrences(ACCESS, { includeInactiveWorksites: true })).length).toBe(94)
  })

  /* El tercer estado (2026-09-19). Lo que se protege no es que el valor exista:
   * es que salga del programa sin dejar rastros del estado anterior, y que
   * exija una explicación que un fiscalizador pueda leer. */
  it("declara una ocurrencia no aplicable con motivo, y lo exige", async () => {
    const {
      ensurePreventionTrainingOccurrencesForWorksiteTx,
      listTrainingOccurrences,
      recordTrainingOccurrenceStatus,
      uploadTrainingOccurrenceEvidence,
    } = await import("@/lib/services/prevention-training-occurrences")

    await ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const rows = await listTrainingOccurrences(ACCESS)
    const target = rows.find((row) => row.code === "CAP-02" && row.slotKey === "m09-w4")
    if (!target) throw new Error("No se encontró la ocurrencia de prueba.")

    // Sin motivo, y con un motivo de relleno: los dos se rechazan.
    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "not_applicable",
    }, ACCESS)).rejects.toThrow()
    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "not_applicable",
      notApplicableReason: "no va",
    }, ACCESS)).rejects.toThrow()

    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "not_applicable",
      notApplicableReason: "La faena no opera equipos de izaje: el curso no corresponde.",
    }, ACCESS)).resolves.toMatchObject({ status: "not_applicable", version: 2 })

    const [declared] = await inMemoryDb.select().from(schema.preventionTrainingOccurrences)
      .where(eq(schema.preventionTrainingOccurrences.id, target.id))
    expect(declared).toMatchObject({
      status: "not_applicable",
      notApplicableByUserId: USER_ID,
      completedAt: null,
      completedByUserId: null,
    })
    expect(declared!.notApplicableAt).not.toBeNull()

    // No acredita: una actividad que no corresponde no cumple el programa.
    expect((await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
      .filter((row) => row.sourceId === target.id)).toHaveLength(0)

    // Y no admite evidencia: no hay nada que respaldar.
    await expect(uploadTrainingOccurrenceEvidence({
      occurrenceId: target.id,
      fileName: "acta.pdf",
      fileSize: 8,
      buffer: Buffer.from("%PDF-1.4"),
    }, ACCESS)).rejects.toThrow(/no aplicable/i)

    // El motivo no sobrevive a la corrección: si lo hiciera, el export
    // mostraría un motivo de no-aplicabilidad junto a una capacitación hecha.
    await expect(recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: 2,
      status: "not_completed",
      observation: "Se repuso al programa tras revisar la dotación.",
    }, ACCESS)).resolves.toMatchObject({ status: "not_completed", version: 3 })
    const [corrected] = await inMemoryDb.select().from(schema.preventionTrainingOccurrences)
      .where(eq(schema.preventionTrainingOccurrences.id, target.id))
    expect(corrected).toMatchObject({
      status: "not_completed",
      notApplicableAt: null,
      notApplicableByUserId: null,
      notApplicableReason: null,
    })
  })

  /* La regresión más cara: la revocación comparaba contra `not_completed`
   * literal, así que corregir a "no aplica" una ocurrencia ya acreditada
   * dejaba viva la acreditación y el programa la seguía contando cumplida. */
  it("revoca la acreditación al salir de hecha hacia no aplica", async () => {
    const {
      ensurePreventionTrainingOccurrencesForWorksiteTx,
      listTrainingOccurrences,
      recordTrainingOccurrenceStatus,
    } = await import("@/lib/services/prevention-training-occurrences")

    await ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const rows = await listTrainingOccurrences(ACCESS)
    const target = rows.find((row) => row.code === "CAP-02" && row.slotKey === "m09-w4")
    if (!target) throw new Error("No se encontró la ocurrencia de prueba.")

    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values({
      id: "training-occ-evidence-na",
      occurrenceId: target.id,
      fileName: "acta.pdf",
      storagePath: "storage/prevention-training-evidence/test-acta-na.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 128,
      sha256: "b".repeat(64),
      state: "active",
      uploadedByUserId: USER_ID,
    })
    await recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "completed",
    }, ACCESS)

    await recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: 2,
      status: "not_applicable",
      notApplicableReason: "Se detectó que la faena no ejecuta esta tarea.",
    }, ACCESS)

    const events = (await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
      .filter((row) => row.sourceId === target.id)
    expect(events.map((row) => row.eventType).sort()).toEqual(["completed", "revoked"])

    // La evidencia de la ocurrencia acreditada se conserva, anulada.
    const [evidence] = await inMemoryDb.select().from(schema.preventionTrainingOccurrenceEvidence)
      .where(eq(schema.preventionTrainingOccurrenceEvidence.id, "training-occ-evidence-na"))
    expect(evidence).toMatchObject({ state: "annulled" })
  })

  it("protege los actores requeridos por los checks de consistencia", async () => {
    const {
      ensurePreventionTrainingOccurrencesForWorksiteTx,
      listTrainingOccurrences,
      recordTrainingOccurrenceStatus,
    } = await import("@/lib/services/prevention-training-occurrences")

    await ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, WORKSITE_ID)
    const target = (await listTrainingOccurrences(ACCESS)).find((row) => row.code === "CAP-01")
    if (!target) throw new Error("No se encontró la ocurrencia de prueba.")

    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values({
      id: "training-occ-evidence-required-actor",
      occurrenceId: target.id,
      fileName: "acta-charla.pdf",
      storagePath: "storage/prevention-training-evidence/test-acta-charla.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 128,
      sha256: "b".repeat(64),
      state: "active",
      uploadedByUserId: USER_ID,
    })

    await recordTrainingOccurrenceStatus({
      occurrenceId: target.id,
      expectedVersion: target.version,
      status: "completed",
    }, ACCESS)

    await expect(
      inMemoryDb.delete(schema.users).where(eq(schema.users.id, USER_ID)),
    ).rejects.toThrow()
  })
})
