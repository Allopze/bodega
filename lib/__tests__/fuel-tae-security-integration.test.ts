import { createHash } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime; postgres-js difiere sólo en el tipo HKT del resultado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getTaeLinkWorksiteId, createTaeSubmission, reviewTaeSubmission } = await import("@/lib/services/fuel-tae")

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

/**
 * Prueba de integración PostgreSQL de la superficie de seguridad pública TAE
 * (sección 19): un token revocado, manipulado o expirado no debe dar acceso,
 * y una carga no puede colar un equipo o faena que no corresponde al enlace
 * — aunque el cliente los mande manualmente en el payload.
 */
describe("seguridad de la PWA pública TAE (PostgreSQL integration)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleInA = nanoid()
  const vehicleInB = nanoid()
  const productId = nanoid()
  const loadingPointId = nanoid()
  const userId = nanoid()
  const validToken = "valid-token-1234567890"
  const revokedToken = "revoked-token-1234567890"
  const expiredToken = "expired-token-1234567890"

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Admin", email: `admin-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehicleInA, plate: `AA${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true },
      { id: vehicleInB, plate: `BB${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteB, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelVehicleProducts).values([
      { vehicleId: vehicleInA, productId },
      { vehicleId: vehicleInB, productId },
    ])
    await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: loadingPointId, worksiteId: worksiteA, name: "Punto 1", type: "truck_dispenser" })
    await inMemoryDb.insert(schema.fuelTaePublicLinks).values([
      { id: nanoid(), worksiteId: worksiteA, loadingPointId, label: "Vigente", tokenHash: hashToken(validToken), createdBy: userId },
      { id: nanoid(), worksiteId: worksiteA, loadingPointId, label: "Revocado", tokenHash: hashToken(revokedToken), revokedAt: new Date().toISOString(), createdBy: userId },
      { id: nanoid(), worksiteId: worksiteA, loadingPointId, label: "Expirado", tokenHash: hashToken(expiredToken), expiresAt: "2020-01-01T00:00:00.000Z", createdBy: userId },
    ])
  })

  it("un token revocado no da acceso", async () => {
    await expect(getTaeLinkWorksiteId(revokedToken)).rejects.toThrow("Este enlace TAE no está disponible")
  })

  it("un token expirado no da acceso", async () => {
    await expect(getTaeLinkWorksiteId(expiredToken)).rejects.toThrow("Este enlace TAE no está disponible")
  })

  it("un token inexistente o manipulado (no coincide ningún hash) no da acceso", async () => {
    await expect(getTaeLinkWorksiteId("token-que-nunca-existio")).rejects.toThrow("Este enlace TAE no está disponible")
  })

  it("un token vigente sí da acceso a su propia faena", async () => {
    await expect(getTaeLinkWorksiteId(validToken)).resolves.toBe(worksiteA)
  })

  const fourEvidences = (["odometer", "liter_meter", "removed_seal", "installed_seal"] as const).map((kind) => ({
    kind, fileName: `${kind}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]),
  }))

  function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      clientSubmissionId: nanoid(20),
      worksiteId: worksiteA,
      loadingPointId,
      vehicleId: vehicleInA,
      productId,
      equipmentCode: "AA-1",
      plate: null,
      loadedAt: new Date().toISOString(),
      driverWorkerId: "",
      driverName: "Conductor",
      supervisorWorkerId: "",
      supervisorName: "Supervisor",
      manualIdentity: false,
      meterType: "odometer" as const,
      meterReading: 100,
      meterUnavailableReason: null,
      liters: 50,
      removedSealNumber: "S1",
      installedSealNumber: "S2",
      noSealReason: null,
      notes: null,
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  it("rechaza una faena distinta a la del enlace, aunque el cliente la envíe manualmente", async () => {
    await expect(createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ worksiteId: worksiteB }),
      evidence: fourEvidences,
    })).rejects.toThrow("La faena no corresponde al enlace")
  })

  it("rechaza un equipo que pertenece a otra faena, aunque el cliente lo envíe manualmente", async () => {
    await expect(createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ vehicleId: vehicleInB }),
      evidence: fourEvidences,
    })).rejects.toThrow("El equipo no pertenece a la faena o está inactivo")
  })

  it("resuelve reintentos simultáneos por clientSubmissionId sin duplicar la carga ni sus evidencias", async () => {
    const input = baseInput({ clientSubmissionId: nanoid(20) })
    const [first, second] = await Promise.all([
      createTaeSubmission({ accessToken: validToken, input, evidence: fourEvidences }),
      createTaeSubmission({ accessToken: validToken, input, evidence: fourEvidences }),
    ])

    expect(new Set([first.id, second.id])).toHaveLength(1)
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true])

    const submissions = await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.clientSubmissionId, input.clientSubmissionId))
    const evidences = await inMemoryDb.select().from(schema.fuelTaeEvidence)
      .where(eq(schema.fuelTaeEvidence.submissionId, first.id))
    expect(submissions).toHaveLength(1)
    expect(evidences).toHaveLength(4)
  })

  it("conserva OCR de baja confianza como sugerencia y exige confirmación humana para validar", async () => {
    const result = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ meterReading: null }),
      evidence: fourEvidences,
      ocrResult: { value: 987_654, confidence: 0.42, rawText: "987654" },
    })
    const [submission] = await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.id, result.id))

    expect(submission).toMatchObject({
      meterReading: null,
      meterReadingSource: null,
      ocrSuggestedReading: 987_654,
      ocrConfidence: 0.42,
      ocrRawText: "987654",
    })
    await expect(reviewTaeSubmission({
      id: result.id,
      expectedStatus: "submitted",
      status: "validated",
      reviewNote: "Revisión de prueba.",
      userId,
    })).rejects.toThrow("Confirma o corrige manualmente")
  })

  it("prioriza la lectura manual y conserva la sugerencia OCR para trazabilidad", async () => {
    const result = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ meterReading: 123_456 }),
      evidence: fourEvidences,
      ocrResult: { value: 987_654, confidence: 0.42, rawText: "987654" },
    })
    const [submission] = await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.id, result.id))

    expect(submission).toMatchObject({
      meterReading: 123_456,
      meterReadingSource: "manual",
      ocrSuggestedReading: 987_654,
      ocrConfidence: 0.42,
    })
  })

  it("aplica OCR sólo cuando no hay lectura manual y supera el umbral de confianza", async () => {
    const result = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ meterReading: null }),
      evidence: fourEvidences,
      ocrResult: { value: 654_321, confidence: 0.91, rawText: "654321" },
    })
    const [submission] = await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.id, result.id))

    expect(submission).toMatchObject({
      meterReading: 654_321,
      meterReadingSource: "ocr",
      ocrSuggestedReading: 654_321,
      ocrConfidence: 0.91,
    })
  })

  it("revierte la carga completa cuando falla la auditoría y permite reintentar con la misma clave", async () => {
    const input = baseInput({ clientSubmissionId: nanoid(20) })
    const evidenceBefore = await inMemoryDb.select().from(schema.fuelTaeEvidence)
    const auditBefore = await inMemoryDb.select().from(schema.auditLog)
    const historyBefore = await inMemoryDb.select().from(schema.statusHistory)

    await pg.exec(`
      CREATE OR REPLACE FUNCTION test_fail_tae_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected TAE audit failure';
      END;
      $$;
      CREATE TRIGGER test_fail_tae_audit_trigger
      BEFORE INSERT ON audit_log
      FOR EACH ROW
      WHEN (NEW.entity_type = 'fuel_tae_submission')
      EXECUTE FUNCTION test_fail_tae_audit();
    `)
    try {
      await expect(createTaeSubmission({ accessToken: validToken, input, evidence: fourEvidences }))
        .rejects.toThrow()
    } finally {
      await pg.exec(`
        DROP TRIGGER test_fail_tae_audit_trigger ON audit_log;
        DROP FUNCTION test_fail_tae_audit();
      `)
    }

    expect(await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.clientSubmissionId, input.clientSubmissionId))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.fuelTaeEvidence)).toHaveLength(evidenceBefore.length)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(auditBefore.length)
    expect(await inMemoryDb.select().from(schema.statusHistory)).toHaveLength(historyBefore.length)

    const retried = await createTaeSubmission({ accessToken: validToken, input, evidence: fourEvidences })
    expect(retried.duplicate).toBe(false)
    expect(await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.clientSubmissionId, input.clientSubmissionId))).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.fuelTaeEvidence)
      .where(eq(schema.fuelTaeEvidence.submissionId, retried.id))).toHaveLength(4)
    expect(await inMemoryDb.select().from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, retried.id))).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.statusHistory)
      .where(and(eq(schema.statusHistory.entityType, "fuel_tae_submission"), eq(schema.statusHistory.entityId, retried.id)))).toHaveLength(1)
  })
})
