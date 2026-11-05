/**
 * Ciclo TAE y sellos contra PostgreSQL real (PGlite con todas las migraciones),
 * corrección de la auditoría 2026-11-05 del módulo de combustibles.
 *
 * Cubre, por hallazgo:
 *  - B1 (5.1) la guarda de OCR no bloquea equipos sin medidor ni lecturas manuales;
 *  - B2 (5.3) la cola del dispositivo cuenta rechazadas y en vuelo, no sólo pendientes;
 *  - B3 (2.7/5.4) dejar de validar una carga retracta sus sellos y reevalúa la cadena;
 *  - B4 (2.6/4.9) revertir un lote archiva sellos, cierra pedidos y descarta casos;
 *  - B5 (4.8) un ID histórico repetido se rechaza por fila y no aborta el lote;
 *  - B7 (2.8) el movimiento manual de estanque es idempotente y no acepta el futuro.
 */

import path from "node:path"
import "fake-indexeddb/auto"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

const auth = vi.hoisted(() => ({
  user: { id: "user-tae-ciclo", email: "ciclo@example.test", isGlobal: true, worksiteIds: [] as string[], roles: ["admin"], permissions: [] as string[] },
}))

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/auth/can", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/can")>()),
  guardPermission: vi.fn(async () => ({
    session: { user: { ...auth.user, name: "Admin", primaryWorksiteId: null, avatarColor: null, isActive: true }, expires: "2099-01-01T00:00:00.000Z" },
    error: null,
  })),
  can: vi.fn(() => true),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { createInternalFieldLoad, reviewTaeSubmission } from "@/lib/services/fuel-tae"
import { countPendingTaeSubmissions, countTaeQueue, deleteTaeSubmission, enqueueTaeSubmission, isUnfinishedTaeStatus, updateTaeSubmission } from "@/lib/pwa/tae-offline-queue"
import { createFuelCycleMovement } from "@/lib/combustibles/fuel-cycle"
import { getFuelCycleComparison } from "@/lib/combustibles/fuel-cycle"
import { importTaeLegacyWorkbook } from "@/lib/combustibles/tae-import-service"
import { getSealHistory } from "@/lib/combustibles/seal-history"
import { getSupervisorSealSummary } from "@/lib/combustibles/control/queries/seals"
import { revertTaeImportBatchAction } from "@/app/(app)/combustibles/tae/importar/actions"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import ExcelJS from "exceljs"

const WORKSITE = "ws-tae-ciclo"
const PRODUCT = "prod-tae-ciclo"
const TYPE = "type-tae-ciclo"
const POINT = "point-tae-ciclo"
const SUPPLIER = "supp-tae-ciclo"
const LOCATION = "loc-tae-ciclo"
const USER = auth.user.id

const session = (): Session => ({ user: { ...auth.user, worksiteIds: [WORKSITE] }, expires: "2099-01-01T00:00:00.000Z" }) as Session

let vehicleSeq = 0
async function newVehicle(meterType: "odometer" | "hour_meter" | "none" = "odometer") {
  vehicleSeq += 1
  const id = nanoid()
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id, plate: `TC${vehicleSeq}${nanoid().slice(0, 3).toUpperCase()}`, code: `TC-${vehicleSeq}`, type: "camion", equipmentTypeId: TYPE,
    worksiteId: WORKSITE, isActive: true, meterType, tankCapacityLiters: 500, performanceUnit: "km_per_liter",
  })
  await inMemoryDb.insert(schema.fuelVehicleProducts).values({ vehicleId: id, productId: PRODUCT })
  return id
}

const photo = (kind: "odometer" | "liter_meter" | "removed_seal" | "installed_seal") => ({ kind, fileName: `${kind}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]) })
const FOUR_PHOTOS = (["odometer", "liter_meter", "removed_seal", "installed_seal"] as const).map(photo)

/** Carga de otro día: permite fijar el orden de la serie sin depender del reloj. */
async function load(vehicleId: string, options: { daysAgo: number; reading?: number | null; removed?: string; installed?: string; ocr?: { value: number | null; confidence: number; rawText: string } }) {
  return createInternalFieldLoad({
    userId: USER,
    input: {
      clientSubmissionId: nanoid(20), worksiteId: WORKSITE, loadingPointId: POINT, vehicleId, productId: PRODUCT,
      supplyMediumId: "fsm-tae", equipmentCode: "TC-1", plate: null, offline: false,
      driverWorkerId: "", driverName: "Conductor Uno", supervisorWorkerId: "", supervisorName: "Supervisor Uno",
      manualIdentity: false, meterType: "odometer", meterReading: options.reading === undefined ? 1000 : options.reading,
      meterUnavailableReason: null, liters: 100, removedSealNumber: options.removed ?? "S-0", installedSealNumber: options.installed ?? "S-1",
      noSealReason: null, notes: null, acknowledgeDuplicate: true,
      pastLoad: { loadedAt: `${addDaysToPlainDate(todayInChile(), -options.daysAgo)}T10:00`, reason: "Se anotó en papel y se ingresó después" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    evidence: FOUR_PHOTOS,
    allowPastLoad: true,
    ocrResult: options.ocr,
  })
}

const submission = async (id: string) => (await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, id)))[0]!
/** Columnas de archivo del sello: no están en el schema Drizzle (las agrega el carril E). */
const sealRows = async (submissionId: string) =>
  (await pg.query<{ id: string; movement_type: string; reverted_at: string | null; reverted_reason: string | null }>(
    "select id, movement_type, reverted_at, reverted_reason from fuel_seal_movements where submission_id = $1 order by movement_type",
    [submissionId],
  )).rows
const audits = (entityType: string, entityId: string) =>
  inMemoryDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId)))

beforeAll(async () => {
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Ciclo", code: "FC-1", isActive: true })
  await inMemoryDb.insert(schema.users).values({ id: USER, name: "Admin", email: auth.user.email, hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: TYPE, slug: "camion-ciclo", name: "Camión" })
  await inMemoryDb.insert(schema.fuelProducts).values({ id: PRODUCT, code: "DIESEL-CICLO", name: "Diésel", category: "diesel", unit: "liter" })
  await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: POINT, worksiteId: WORKSITE, name: "Surtidor Ciclo", type: "fixed_dispenser" })
  await inMemoryDb.insert(schema.fuelSuppliers).values({ id: SUPPLIER, name: "Proveedor Ciclo", isActive: true })
  await inMemoryDb.insert(schema.fuelStorageLocations).values({ id: LOCATION, worksiteId: WORKSITE, productId: PRODUCT, name: "Estanque Ciclo", capacityLiters: 10000, isActive: true })
  await inMemoryDb.insert(schema.fuelAnomalyRules).values({ id: "rule-sello-repetido", code: "sello_repetido", name: "Sello repetido", severity: "high", isActive: true }).onConflictDoNothing()
}, 60_000)

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("B1 · la guarda de OCR no traba equipos sin medidor ni lecturas manuales (5.1)", () => {
  it("valida una carga de un equipo sin medidor aunque el OCR haya sugerido una lectura dudosa", async () => {
    const vehicleId = await newVehicle("none")
    const created = await load(vehicleId, { daysAgo: 2, reading: null, removed: "N-0", installed: "N-1", ocr: { value: 7777, confidence: 0.2, rawText: "7777?" } })
    const row = await submission(created.id)
    expect(row).toMatchObject({ meterReading: null, meterReadingSource: null, ocrSuggestedReading: 7777 })

    await reviewTaeSubmission({ id: created.id, expectedStatus: "submitted", status: "validated", userId: USER })
    expect((await submission(created.id)).status).toBe("validated")
  })

  it("valida una lectura manual aunque el OCR tenga baja confianza: la persona ya la confirmó", async () => {
    const vehicleId = await newVehicle("odometer")
    const created = await load(vehicleId, { daysAgo: 1, reading: 1500, ocr: { value: 1450, confidence: 0.1, rawText: "1450" } })
    expect(await submission(created.id)).toMatchObject({ meterReadingSource: "manual", meterReading: 1500 })

    await reviewTaeSubmission({ id: created.id, expectedStatus: "submitted", status: "validated", userId: USER })
    expect((await submission(created.id)).status).toBe("validated")
  })

  it("sigue bloqueando una lectura que nadie confirmó (fuente `ocr`) con OCR dudoso", async () => {
    const vehicleId = await newVehicle("odometer")
    const created = await load(vehicleId, { daysAgo: 1, reading: 900, ocr: { value: 900, confidence: 0.2, rawText: "900" } })
    // Control de que la guarda no quedó muerta: una lectura que no puso una persona.
    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ meterReadingSource: "ocr" }).where(eq(schema.fuelTaeSubmissions.id, created.id))

    await expect(reviewTaeSubmission({ id: created.id, expectedStatus: "submitted", status: "validated", userId: USER }))
      .rejects.toThrow(/OCR/i)
    expect((await submission(created.id)).status).toBe("submitted")
  })
})

describe("B2 · la cola del dispositivo no se declara vacía con cargas rechazadas (5.3)", () => {
  it("cuenta pendientes, en vuelo y rechazadas; sólo la sincronizada libera el acceso", async () => {
    const id = "b2-carga-rechazada"
    await deleteTaeSubmission(id)
    await enqueueTaeSubmission("token-b2", { clientSubmissionId: id, worksiteId: WORKSITE }, [])

    expect(await countPendingTaeSubmissions()).toBe(1)
    await updateTaeSubmission(id, { status: "syncing" })
    expect(await countPendingTaeSubmissions()).toBe(1)
    await updateTaeSubmission(id, { status: "failed", lastError: "Litros inválidos" })
    expect(await countPendingTaeSubmissions()).toBe(1)
    expect(await countTaeQueue()).toMatchObject({ total: 1, pending: 0, syncing: 0, failed: 1 })

    await updateTaeSubmission(id, { status: "synced", syncedAt: new Date().toISOString() })
    expect(await countPendingTaeSubmissions()).toBe(0)
    expect(isUnfinishedTaeStatus("failed")).toBe(true)
    expect(isUnfinishedTaeStatus("synced")).toBe(false)
    await deleteTaeSubmission(id)
  })
})

describe("B3 · dejar de validar una carga retracta sus sellos y reevalúa la cadena (2.7/5.4)", () => {
  it("validated → observed marca el movimiento revertido y revalidar lo reactiva, con auditoría", async () => {
    const vehicleId = await newVehicle()
    const first = await load(vehicleId, { daysAgo: 10, reading: 1000, removed: "S-8", installed: "S-9" })
    const second = await load(vehicleId, { daysAgo: 5, reading: 1200, removed: "S-9", installed: "S-10" })
    await reviewTaeSubmission({ id: first.id, expectedStatus: "submitted", status: "validated", userId: USER })
    await reviewTaeSubmission({ id: second.id, expectedStatus: "submitted", status: "validated", userId: USER })
    expect((await sealRows(second.id)).map((row) => row.reverted_at)).toEqual([null, null])

    await reviewTaeSubmission({ id: second.id, expectedStatus: "validated", status: "observed", reviewNote: "Sello dudoso en la foto", userId: USER })
    const retracted = await sealRows(second.id)
    expect(retracted).toHaveLength(2)
    expect(retracted.every((row) => row.reverted_at != null && /observed/.test(row.reverted_reason ?? ""))).toBe(true)
    expect(await audits("fuel_seal_movement", retracted[0]!.id)).toHaveLength(1)

    await reviewTaeSubmission({ id: second.id, expectedStatus: "observed", status: "validated", userId: USER })
    expect((await sealRows(second.id)).map((row) => row.reverted_at)).toEqual([null, null])
  })

  it("al anular una carga la siguiente cambia de «carga anterior» y su cadena se recalcula", async () => {
    const vehicleId = await newVehicle()
    const before = await load(vehicleId, { daysAgo: 20, reading: 1000, removed: "S-7", installed: "S-9" })
    const target = await load(vehicleId, { daysAgo: 10, reading: 1100, removed: "S-9", installed: "S-1" })
    const after = await load(vehicleId, { daysAgo: 5, reading: 1200, removed: "S-1", installed: "S-2" })
    for (const item of [before, target, after]) {
      await reviewTaeSubmission({ id: item.id, expectedStatus: "submitted", status: "validated", userId: USER })
    }
    expect(await submission(after.id)).toMatchObject({ sealChainStatus: "ok", sealChainExpected: null })

    await reviewTaeSubmission({ id: target.id, expectedStatus: "validated", status: "voided", reviewNote: "Carga duplicada", userId: USER })

    expect(await submission(target.id)).toMatchObject({ status: "voided" })
    // Sus movimientos quedan archivados, no borrados.
    expect((await sealRows(target.id)).every((row) => row.reverted_at != null)).toBe(true)
    // La siguiente ya no se compara con S-1: su anterior ahora es la primera carga, que instaló S-9.
    expect(await submission(after.id)).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "S-9" })
    const reevaluation = (await audits("fuel_tae_submission", after.id)).find((entry) => entry.action === "update" && /cadena de sellos/.test(entry.reason ?? ""))
    expect(reevaluation).toBeDefined()
    expect(JSON.parse(reevaluation!.newState!)).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "S-9" })
  })
})

describe("B4 · revertir un lote TAE archiva sellos, cierra pedidos y descarta casos (2.6/4.9)", () => {
  /** Un lote importado con dos cargas del mismo equipo, una posterior y las huérfanas habituales. */
  async function seedBatch(batchId: string, vehicleId: string) {
    const fileHash = `hash-${batchId}`
    await inMemoryDb.insert(schema.fuelTaeImportBatches).values({ id: batchId, fileName: "tae.xlsx", fileHash, status: "imported", totalRows: 2, validRows: 2, importedBy: USER })
    const base = {
      source: "legacy_xlsx" as const, importBatchId: batchId, worksiteId: WORKSITE, loadingPointId: POINT,
      vehicleId, productId: PRODUCT, equipmentCodeSnapshot: "TC-X", driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      meterType: "odometer", liters: 100, status: "validated" as const, reviewedBy: USER, reviewedAt: new Date().toISOString(),
    }
    const first = { ...base, id: nanoid(), publicResultToken: nanoid(32), clientSubmissionId: `legacy:${fileHash}:1`, legacySourceId: "1", loadedAt: `${addDaysToPlainDate(todayInChile(), -30)}T10:00:00.000Z`, submittedAt: `${addDaysToPlainDate(todayInChile(), -30)}T10:00:00.000Z`, removedSealNumber: "L-0", installedSealNumber: "L-1" }
    const second = { ...base, id: nanoid(), publicResultToken: nanoid(32), clientSubmissionId: `legacy:${fileHash}:2`, legacySourceId: "2", loadedAt: `${addDaysToPlainDate(todayInChile(), -20)}T10:00:00.000Z`, submittedAt: `${addDaysToPlainDate(todayInChile(), -20)}T10:00:00.000Z`, removedSealNumber: "L-1", installedSealNumber: "L-2" }
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([first, second])
    await inMemoryDb.insert(schema.fuelSealMovements).values({ id: nanoid(), submissionId: first.id, sealNumber: "L-0", movementType: "removed", changedBy: USER })
    await inMemoryDb.insert(schema.fuelReviewMarks).values({ id: nanoid(), entityType: "fuel_tae_submission", entityId: first.id, worksiteId: WORKSITE, markedBy: USER, notes: "Revisar", status: "open" })
    await inMemoryDb.insert(schema.fuelAnomalyCases).values({
      id: nanoid(), ruleId: "rule-sello-repetido", ruleCode: "sello_repetido", severity: "high", worksiteId: WORKSITE, vehicleId,
      referenceEntityType: "fuel_tae_submission", referenceEntityId: second.id, description: "Caso de prueba", status: "open", detectedAt: new Date().toISOString(),
    })
    // Una carga posterior del equipo, fuera del lote: su cadena se calculó contra L-2.
    const later = { ...base, id: nanoid(), publicResultToken: nanoid(32), clientSubmissionId: nanoid(), legacySourceId: null, importBatchId: null, loadedAt: `${addDaysToPlainDate(todayInChile(), -5)}T10:00:00.000Z`, submittedAt: `${addDaysToPlainDate(todayInChile(), -5)}T10:00:00.000Z`, removedSealNumber: "L-2", installedSealNumber: "L-3", sealChainStatus: "mismatch", sealChainExpected: "L-2" }
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values(later)
    return { first, second, later }
  }

  it("no borra el historial de sellos, cierra los pedidos abiertos, descarta los casos y reevalúa la siguiente", async () => {
    const vehicleId = await newVehicle()
    const batchId = `batch-${nanoid(8)}`
    const { first, second, later } = await seedBatch(batchId, vehicleId)

    const result = await revertTaeImportBatchAction(batchId)
    expect(result.ok).toBe(true)

    expect((await inMemoryDb.select().from(schema.fuelTaeImportBatches).where(eq(schema.fuelTaeImportBatches.id, batchId)))[0]!.status).toBe("reverted")
    expect(await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.importBatchId, batchId))).toHaveLength(0)
    expect((await inMemoryDb.select().from(schema.fuelReviewMarks).where(eq(schema.fuelReviewMarks.entityId, first.id)))[0]).toMatchObject({ status: "withdrawn", resolvedBy: USER })
    expect((await inMemoryDb.select().from(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.referenceEntityId, second.id)))[0]).toMatchObject({ status: "dismissed", resolvedById: USER })
    // La cadena de la siguiente se recalcula con la carga anterior que le queda.
    expect(await submission(later.id)).toMatchObject({ sealChainStatus: "no_previous", sealChainExpected: null })

    const audit = (await audits("fuel_tae_import_batch", batchId)).at(-1)!
    expect(JSON.parse(audit.newState!)).toMatchObject({ status: "reverted", reviewMarksClosed: 1, anomalyCasesDismissed: 1, sealMovementsArchived: 1 })
  })

  it("conserva el movimiento archivado con la FK ON DELETE SET NULL de la migración 0373", async () => {
    const vehicleId = await newVehicle()
    const batchId = `batch-${nanoid(8)}`
    const { first } = await seedBatch(batchId, vehicleId)

    expect((await revertTaeImportBatchAction(batchId)).ok).toBe(true)

    const [archived] = (await pg.query<{ submission_id: string | null; reverted_at: string | null }>(
      "select submission_id, reverted_at from fuel_seal_movements where seal_number = 'L-0' order by created_at desc limit 1",
    )).rows
    expect(archived).toBeDefined()
    expect(archived!.submission_id).toBeNull()
    expect(archived!.reverted_at).not.toBeNull()
    expect(first.id).toBeTruthy()
  })
})

describe("B5 · un ID histórico repetido se rechaza por fila, no aborta el lote (4.8)", () => {
  it("importa la primera aparición de cada ID y deja las repetidas como rechazo", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Cargas")
    sheet.addRow(["ID", "Faena", "Fecha y hora", "Lugar de carga", "Supervisor / líder", "Conductor", "Equipo", "Odómetro", "Litros"])
    sheet.addRow([1, "Faena Ciclo", new Date("2026-07-01T08:38:32.100Z"), "Surtidor Ciclo", "Luis Riquelme", "Carlos Norambuena", "TC-B5", 2098, 118])
    sheet.addRow([1, "Faena Ciclo", new Date("2026-07-02T08:38:32.100Z"), "Surtidor Ciclo", "Luis Riquelme", "Carlos Norambuena", "TC-B5", 2200, 120])
    sheet.addRow([2, "Faena Ciclo", new Date("2026-07-03T08:38:32.100Z"), "Surtidor Ciclo", "Luis Riquelme", "Carlos Norambuena", "TC-B5", 2300, 130])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const result = await importTaeLegacyWorkbook({ buffer, fileName: "tae-duplicado.xlsx", userId: USER })
    expect(result).toMatchObject({ importedRows: 2, invalidRows: 1 })

    const imported = await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.importBatchId, result.batchId))
    expect(imported.map((row) => row.legacySourceId).sort()).toEqual(["1", "2"])
    const rejections = await inMemoryDb.select().from(schema.fuelTaeImportRejections).where(eq(schema.fuelTaeImportRejections.batchId, result.batchId))
    expect(rejections).toHaveLength(1)
    expect(rejections[0]).toMatchObject({ field: "ID", legacySourceId: "1", stage: "parse" })
    expect(rejections[0]!.message).toMatch(/repetido/i)
  })
})

describe("B7 · el movimiento manual de estanque es idempotente y no acepta el futuro (2.8)", () => {
  const base = {
    eventType: "received" as const, worksiteId: WORKSITE, productId: PRODUCT, quantity: 500,
    supplierId: SUPPLIER, targetLocationId: LOCATION,
  }
  const countMovements = async () => (await inMemoryDb.select().from(schema.fuelCycleMovements).where(eq(schema.fuelCycleMovements.worksiteId, WORKSITE))).length

  it("un doble submit con el mismo documento registra los litros una sola vez", async () => {
    const before = await countMovements()
    const occurredAt = new Date().toISOString()
    const first = await createFuelCycleMovement({ ...base, occurredAt, documentNumber: "GUIA-B7-1" }, { userId: USER })
    const retry = await createFuelCycleMovement({ ...base, occurredAt, documentNumber: "GUIA-B7-1" }, { userId: USER })

    expect(retry).toMatchObject({ id: first.id, duplicate: true })
    expect(await countMovements()).toBe(before + 1)
  })

  it("sin documento usa la clave del formulario: dos envíos distintos no se pisan", async () => {
    const before = await countMovements()
    const occurredAt = new Date().toISOString()
    const first = await createFuelCycleMovement({ ...base, occurredAt, clientSubmissionId: "formulario-b7-1" }, { userId: USER })
    const retry = await createFuelCycleMovement({ ...base, occurredAt, clientSubmissionId: "formulario-b7-1" }, { userId: USER })
    await createFuelCycleMovement({ ...base, occurredAt, clientSubmissionId: "formulario-b7-2" }, { userId: USER })

    expect(first.duplicate).toBe(false)
    expect(retry).toMatchObject({ id: first.id, duplicate: true })
    expect(await countMovements()).toBe(before + 2)
  })

  it("rechaza un movimiento con fecha futura y no escribe nada", async () => {
    const before = await countMovements()
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await expect(createFuelCycleMovement({ ...base, occurredAt: future, documentNumber: "GUIA-FUTURA" }, { userId: USER })).rejects.toThrow(/futura/i)
    expect(await countMovements()).toBe(before)
  })
})

describe("B8/B9 · sin facturas no se muestra «0 registrado» y las tres pestañas de sellos cuentan lo mismo (5.6/5.8)", () => {
  it("la etapa «Facturado» es null cuando no hay cargas facturadas", async () => {
    const comparison = await getFuelCycleComparison(session(), { worksiteId: WORKSITE, from: "2020-01-01", to: "2099-12-31" })
    expect(comparison.registered).toBeNull()
  })

  it("el historial de sellos incluye observadas y enviadas, y cuadra con «Por supervisor»", async () => {
    const vehicleId = await newVehicle()
    const validated = await load(vehicleId, { daysAgo: 42, reading: 100, removed: "H-0", installed: "H-1" })
    await reviewTaeSubmission({ id: validated.id, expectedStatus: "submitted", status: "validated", userId: USER })
    const observed = await load(vehicleId, { daysAgo: 41, reading: 200, removed: "H-1", installed: "H-2" })
    await reviewTaeSubmission({ id: observed.id, expectedStatus: "submitted", status: "observed", reviewNote: "Revisar lectura", userId: USER })
    const submitted = await load(vehicleId, { daysAgo: 40, reading: 300, removed: "H-2", installed: "H-3" })
    const voided = await load(vehicleId, { daysAgo: 39, reading: 400, removed: "H-3", installed: "H-4" })
    await reviewTaeSubmission({ id: voided.id, expectedStatus: "submitted", status: "voided", reviewNote: "Duplicada", userId: USER })

    // Ventana propia de esta prueba: las otras cargas del archivo caen fuera.
    const from = addDaysToPlainDate(todayInChile(), -43)
    const to = addDaysToPlainDate(todayInChile(), -39)
    const filters = { year: Number(from.slice(0, 4)), months: [], page: 1, from, to, worksiteId: WORKSITE }
    const history = await getSealHistory(session(), { worksiteId: WORKSITE, from, to })
    const ids = new Set(history.map((row) => row.submissionId))
    expect(ids.has(validated.id)).toBe(true)
    expect(ids.has(observed.id)).toBe(true)
    expect(ids.has(submitted.id)).toBe(true)
    expect(ids.has(voided.id)).toBe(false)

    // «Por supervisor» ya contaba las tres: antes el historial mostraba una sola.
    const [summary] = await getSupervisorSealSummary(session(), filters, { canViewPersonal: true })
    expect(summary?.loads).toBe(3)
    expect(history).toHaveLength(summary!.loads)
  })
})
