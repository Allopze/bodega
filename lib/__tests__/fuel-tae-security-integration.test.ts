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

const { getTaeLinkWorksiteId, createTaeSubmission, createInternalFieldLoad, reviewTaeSubmission } = await import("@/lib/services/fuel-tae")
const { TaeSubmissionRejected } = await import("@/lib/services/fuel-tae/errors")
const { projectTaeSubmissions } = await import("@/lib/combustibles/control/projection")

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
  const meteredVehicle = nanoid()
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
      { id: meteredVehicle, plate: `CC${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true, meterType: "odometer", tankCapacityLiters: 300 },
    ])
    await inMemoryDb.insert(schema.fuelVehicleProducts).values([
      { vehicleId: vehicleInA, productId },
      { vehicleId: vehicleInB, productId },
      { vehicleId: meteredVehicle, productId },
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

  // Cada carga sube la lectura: una menor se rechaza (D-6).
  let reading = 1000
  const nextReading = () => (reading += 10)

  function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      clientSubmissionId: nanoid(20),
      worksiteId: worksiteA,
      loadingPointId,
      vehicleId: vehicleInA,
      productId,
      supplyMediumId: "fsm-tae",
      equipmentCode: "AA-1",
      plate: null,
      offline: false,
      driverWorkerId: "",
      driverName: "Conductor",
      supervisorWorkerId: "",
      supervisorName: "Supervisor",
      manualIdentity: false,
      meterType: "odometer" as const,
      meterReading: nextReading(),
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

  // CO-016: revalidar una carga volvía a insertar el movimiento de sello
  // retirado (la instalación sí deduplicaba, el retiro no). El historial del
  // sello mostraba dos retiros del mismo sello en el mismo acto.
  it("revalidar una carga no duplica los movimientos de sello", async () => {
    const result = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ removedSealNumber: "SR-1", installedSealNumber: "SI-1" }),
      evidence: fourEvidences,
    })

    const review = (expectedStatus: "submitted" | "observed" | "validated", status: "observed" | "validated") =>
      reviewTaeSubmission({ id: result.id, expectedStatus, status, reviewNote: "Revisión de prueba.", userId })

    await review("submitted", "validated")
    await review("validated", "observed")
    await review("observed", "validated")

    const movements = await inMemoryDb.select().from(schema.fuelSealMovements)
      .where(eq(schema.fuelSealMovements.submissionId, result.id))
    expect(movements).toHaveLength(2)
    expect(movements.map((movement) => movement.movementType).sort()).toEqual(["installed", "removed"])
  })

  it("prioriza la lectura manual y conserva la sugerencia OCR para trazabilidad", async () => {
    const typed = nextReading()
    const result = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ meterReading: typed }),
      evidence: fourEvidences,
      ocrResult: { value: 987_654, confidence: 0.42, rawText: "987654" },
    })
    const [submission] = await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.id, result.id))

    expect(submission).toMatchObject({
      meterReading: typed,
      meterReadingSource: "manual",
      ocrSuggestedReading: 987_654,
      ocrConfidence: 0.42,
    })
  })

  it("el OCR nunca ocupa el lugar de la lectura digitada: sin lectura queda solo como sugerencia", async () => {
    const result = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ meterReading: null }),
      evidence: fourEvidences,
      ocrResult: { value: 654_321, confidence: 0.91, rawText: "654321" },
    })
    const [submission] = await inMemoryDb.select().from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.id, result.id))

    expect(submission).toMatchObject({
      meterReading: null,
      meterReadingSource: null,
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

  // ── Reglas de la carga en terreno (C-01, C-08) ───────────────────────────
  const twoEvidences = fourEvidences.filter((item) => item.kind === "odometer" || item.kind === "liter_meter")

  async function rejection(promise: Promise<unknown>) {
    try { await promise } catch (error) { return error }
    return null
  }

  it("rechaza con 422 una lectura menor a la última del equipo y nombra la lectura anterior", async () => {
    const first = await createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: meteredVehicle, meterReading: 50_000.5 }), evidence: fourEvidences })
    expect(first.duplicate).toBe(false)
    const error = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: meteredVehicle, meterReading: 49_000 }), evidence: fourEvidences }))
    expect(error).toBeInstanceOf(TaeSubmissionRejected)
    expect(error).toMatchObject({ status: 422, code: "meter_regression", field: "meterReading" })
    expect((error as Error).message).toContain("50.000,5")
    expect((error as Error).message).toContain("supervisor")
  })

  it("acepta una lectura igual o mayor y exige la lectura en equipos con medidor", async () => {
    const ok = await createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: meteredVehicle, meterReading: 50_000.5, removedSealNumber: "S2", installedSealNumber: "S3" }), evidence: fourEvidences })
    expect(ok.duplicate).toBe(false)
    const missing = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: meteredVehicle, meterReading: null }), evidence: fourEvidences }))
    expect(missing).toMatchObject({ status: 422, code: "reading_required" })
  })

  it("rechaza litros sobre la capacidad del estanque del equipo", async () => {
    const error = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: meteredVehicle, meterReading: 60_000, liters: 301 }), evidence: fourEvidences }))
    expect(error).toMatchObject({ status: 422, code: "over_capacity", field: "liters" })
    // Sin capacidad cargada rige el tope de respaldo de 2.000 L.
    const fallback = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ liters: 2001 }), evidence: fourEvidences }))
    expect(fallback).toMatchObject({ status: 422, code: "over_capacity" })
  })

  it("rechaza sellos de relleno y sello faltante sin motivo", async () => {
    const filler = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ removedSealNumber: "777777" }), evidence: fourEvidences }))
    expect(filler).toMatchObject({ status: 422, code: "filler_seal", field: "removedSealNumber" })
    const noReason = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ removedSealNumber: "", installedSealNumber: "S9" }), evidence: fourEvidences.filter((item) => item.kind !== "removed_seal") }))
    expect(noReason).toMatchObject({ status: 422, code: "seal_reason_required" })
  })

  it("la foto de sello se exige solo si hay número de ese sello", async () => {
    const missingPhoto = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput(), evidence: twoEvidences }))
    expect(missingPhoto).toMatchObject({ status: 422, code: "evidence_missing" })
    const withoutSeals = await createTaeSubmission({
      accessToken: validToken,
      input: baseInput({ removedSealNumber: "", installedSealNumber: "", noSealReason: "Sello cortado" }),
      evidence: twoEvidences,
    })
    const evidences = await inMemoryDb.select().from(schema.fuelTaeEvidence).where(eq(schema.fuelTaeEvidence.submissionId, withoutSeals.id))
    expect(evidences.map((item) => item.kind).sort()).toEqual(["liter_meter", "odometer"])
  })

  it("en línea la hora es la del servidor; desde la cola se conserva la del dispositivo", async () => {
    const before = Date.now()
    const online = await createTaeSubmission({ accessToken: validToken, input: baseInput({ capturedAt: "2026-01-01T00:00:00.000Z" }), evidence: fourEvidences })
    const [row] = await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, online.id))
    expect(row!.loadedAtSource).toBe("server")
    expect(new Date(row!.loadedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)

    const captured = new Date(Date.now() - 2 * 3_600_000).toISOString()
    const queued = await createTaeSubmission({ accessToken: validToken, input: baseInput({ offline: true, capturedAt: captured }), evidence: fourEvidences })
    const [queuedRow] = await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, queued.id))
    expect(queuedRow!.loadedAtSource).toBe("device_offline")
    expect(new Date(queuedRow!.loadedAt).toISOString()).toBe(captured)
    expect(new Date(queuedRow!.submittedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)

    const tooOld = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ offline: true, capturedAt: "2020-01-01T00:00:00.000Z" }), evidence: fourEvidences }))
    expect(tooOld).toMatchObject({ status: 422, code: "invalid_time" })
  })

  it("persiste la cadena de sellos, guarda el sello tal como está grabado y audita la ruptura sin rechazar", async () => {
    const vehicle = meteredVehicle
    const start = 70_000
    await createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: vehicle, meterReading: start, removedSealNumber: "0100", installedSealNumber: "0504" }), evidence: fourEvidences })
    const ok = await createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: vehicle, meterReading: start + 10, removedSealNumber: "504", installedSealNumber: "0600" }), evidence: fourEvidences })
    const broken = await createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: vehicle, meterReading: start + 20, removedSealNumber: "0999", installedSealNumber: "0700" }), evidence: fourEvidences })

    const [okRow] = await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, ok.id))
    expect(okRow).toMatchObject({ sealChainStatus: "ok", sealChainExpected: null, removedSealNumber: "504", installedSealNumber: "0600" })
    const [brokenRow] = await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, broken.id))
    expect(brokenRow).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "0600", removedSealNumber: "0999" })
    const audit = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, broken.id))
    expect(audit).toHaveLength(1)
    expect(audit[0]!.reason).toBe("Cadena de sellos rota: se esperaba 0600")
  })

  it("proyecta la carga a la serie canónica en la misma transacción", async () => {
    const created = await createTaeSubmission({ accessToken: validToken, input: baseInput(), evidence: fourEvidences })
    const loads = await inMemoryDb.select().from(schema.fuelEquipmentLoads).where(eq(schema.fuelEquipmentLoads.taeSubmissionId, created.id))
    expect(loads).toHaveLength(1)
    expect(loads[0]).toMatchObject({ source: "field", worksiteId: worksiteA, vehicleId: vehicleInA, supplyMediumId: "fsm-tae" })
    await reviewTaeSubmission({ id: created.id, expectedStatus: "submitted", status: "voided", reviewNote: "Cargada por error.", userId })
    const [voided] = await inMemoryDb.select().from(schema.fuelEquipmentLoads).where(eq(schema.fuelEquipmentLoads.taeSubmissionId, created.id))
    expect(voided!.voidedAt).not.toBeNull()
  })

  it("contrato del reinicio de medidor: raw_row.meterReset = true marca la carga proyectada como inicio de serie", async () => {
    const created = await createTaeSubmission({ accessToken: validToken, input: baseInput({ vehicleId: meteredVehicle, meterReading: 80_000 }), evidence: fourEvidences })
    await inMemoryDb.update(schema.fuelTaeSubmissions)
      .set({ rawRow: { meterReset: true, meterResetReason: "Cambio de tablero" } })
      .where(eq(schema.fuelTaeSubmissions.id, created.id))
    await inMemoryDb.transaction((tx) => projectTaeSubmissions(tx as never, [created.id]))
    const [load] = await inMemoryDb.select().from(schema.fuelEquipmentLoads).where(eq(schema.fuelEquipmentLoads.taeSubmissionId, created.id))
    expect(load!.meterReset).toBe(true)
  })

  it("rechaza un medio de suministro inexistente o inactivo", async () => {
    const error = await rejection(createTaeSubmission({ accessToken: validToken, input: baseInput({ supplyMediumId: "no-existe" }), evidence: fourEvidences }))
    expect(error).toMatchObject({ status: 422, code: "invalid_medium" })
  })

  it("el registro autenticado guarda la fuente interna y quién registró", async () => {
    const result = await createInternalFieldLoad({ userId, input: baseInput(), evidence: fourEvidences })
    const [row] = await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, result.id))
    expect(row).toMatchObject({ source: "internal_app", registeredBy: userId, loadedAtSource: "server" })
  })
})
