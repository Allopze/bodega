import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { MantEquipmentSnapshot } from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Notas de pedido y consumos de repuestos en la ficha del equipo (R9 de «Notas de pedido ERP», 2026-11-27) contra
 * Postgres de verdad: la nota del equipo (la de su OT o la que carga una línea a él), cada línea en la ficha de UN solo
 * equipo, el alcance de notas y de registros, los registros anulados que no cuentan y el tope con su total.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { loadEquipmentParts, EQUIPMENT_PARTS_LIMIT } = await import("@/lib/services/mantencion/equipment-parts")

const NOW = "2026-11-27T10:00:00.000Z"
const OT_ID = "ot-ep-1"
const SNAPSHOT: MantEquipmentSnapshot = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" }

const viewer = (userId: string, permissions: string[], worksiteIds: string[], isGlobal = false): MantViewer => ({ userId, email: null, permissions, worksiteIds, isGlobal })
const jefe = viewer(IDS.jefe, ["mant:np:view_worksite", "mant:np:manage", "mant:records:view_all"], [], true)
const supBio = viewer(IDS.supBio, ["mant:np:view_worksite", "mant:records:view_worksite"], [IDS.wsBio])
const supAra = viewer(IDS.adminBio, ["mant:np:view_worksite", "mant:records:view_worksite"], [IDS.wsAra])
const mecBio = viewer(IDS.mecBio, ["mant:np:view_own", "mant:records:view_own"], [IDS.wsBio])
const plain = viewer(IDS.plain, [], [])

interface NoteSeed {
  id: string
  code: string
  vehicleId?: string | null
  workOrderId?: string | null
  worksiteId?: string
  requestedBy?: string
  status?: string
  createdAt: string
  urgent?: boolean
  lines: Array<{ id: string; description: string; quantity: number; chargeVehicleId?: string; chargeCostCenterId?: string; resolution?: "pendiente" | "en_compra" }>
}

async function insertNote(seed: NoteSeed) {
  await testDb.insert(schema.mantPartsNotes).values({
    id: seed.id, code: seed.code, workOrderId: seed.workOrderId ?? null, vehicleId: seed.vehicleId ?? null,
    worksiteId: seed.worksiteId ?? IDS.wsBio, requestedByUserId: seed.requestedBy ?? IDS.jefe,
    status: seed.status ?? "enviada", urgent: seed.urgent ?? false, createdAt: seed.createdAt, updatedAt: seed.createdAt,
  })
  await testDb.insert(schema.mantPartsNoteItems).values(seed.lines.map((line, index) => ({
    id: line.id, noteId: seed.id, description: line.description, quantity: line.quantity, sortOrder: index,
    chargeVehicleId: line.chargeVehicleId ?? null, chargeCostCenterId: line.chargeCostCenterId ?? null,
    resolution: line.resolution ?? "pendiente",
    ...(line.resolution && line.resolution !== "pendiente" ? { resolvedByUserId: IDS.jefe, resolvedAt: NOW } : {}),
  })))
}

async function insertRecord(input: { id: string; folio: string; vehicleId?: string; worksiteId?: string; registeredBy?: string; workDate: string; voided?: boolean }) {
  const registeredBy = input.registeredBy ?? IDS.mecBio
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: input.folio, kind: "C", vehicleId: input.vehicleId ?? IDS.truckBio, equipmentSnapshot: SNAPSHOT,
    worksiteId: input.worksiteId ?? IDS.wsBio, reading: 10_000, unit: "km", workDate: input.workDate,
    registeredBy, executorKind: "yo", executorUserId: registeredBy, executorName: "Javier Roa",
    signedAt: NOW, receivedAt: NOW, status: input.voided ? "anulado" : "vigente",
  })
  await testDb.insert(schema.mantRecordCorrectives).values({ recordId: input.id, workTypes: ["Mecánico"], oils: [], description: "Cambio de bomba de agua", noParts: false, hours: 2, inWorkshop: false })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  await testDb.insert(schema.costCenters).values({ id: "cc-ep-bio", code: "CC-EP-BIO", name: "Taller Biodiversa", worksiteId: IDS.wsBio, isActive: true, createdAt: NOW, updatedAt: NOW })
  await testDb.insert(schema.productCategories).values({ id: "cat-ep", name: "Repuestos EP", slug: "repuestos-ep", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  await testDb.insert(schema.products).values({
    id: "p-ep-1", sku: "REP-EP-1", name: "Bomba de agua", categoryId: "cat-ep", unitOfMeasure: "unidad", isSparePart: true,
    partNumber: "PN-EP-1", isActive: true, createdAt: NOW, updatedAt: NOW,
  })
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT_ID, folio: "OT-EP-1", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status: "en_ejecucion",
    assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31",
    startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
  })

  // N1 · la nota de la OT del equipo (sin cargo en las líneas): todas sus líneas son del equipo. La pidió el mecánico.
  await insertNote({
    id: "n-1", code: "NP-2026-0001", vehicleId: IDS.truckBio, workOrderId: OT_ID, requestedBy: IDS.mecBio, status: "en_gestion", urgent: true, createdAt: "2026-11-10T10:00:00.000Z",
    lines: [
      { id: "n-1-a", description: "Filtro hidráulico", quantity: 2 },
      { id: "n-1-b", description: "Sello de pluma", quantity: 1, resolution: "en_compra" },
    ],
  })
  // N2 · sin OT ni equipo: una línea cargada al camión de Biodiversa y otra a la máquina; una tercera al centro «Taller».
  await insertNote({
    id: "n-2", code: "NP-2026-0002", status: "aceptada", createdAt: "2026-11-20T10:00:00.000Z",
    lines: [
      { id: "n-2-a", description: "Cable de acero", quantity: 1, chargeVehicleId: IDS.truckBio },
      { id: "n-2-b", description: "Guantes de cuero", quantity: 6, chargeVehicleId: IDS.machineBio },
      { id: "n-2-c", description: "Disco de corte", quantity: 10, chargeCostCenterId: "cc-ep-bio" },
    ],
  })
  // N3 · nota de la OT del camión, pero su única línea se imputa a «Taller»: no es del equipo.
  await insertNote({
    id: "n-3", code: "NP-2026-0003", vehicleId: IDS.truckBio, workOrderId: OT_ID, createdAt: "2026-11-22T10:00:00.000Z",
    lines: [{ id: "n-3-a", description: "Grasa multipropósito", quantity: 3, chargeCostCenterId: "cc-ep-bio" }],
  })
  // N4 · nota de Cholguán que carga una línea a otro camión: no es del nuestro.
  await insertNote({
    id: "n-4", code: "NP-2026-0004", worksiteId: IDS.wsCho, vehicleId: IDS.truckCho, createdAt: "2026-11-23T10:00:00.000Z",
    lines: [{ id: "n-4-a", description: "Pastillas de freno", quantity: 4 }],
  })

  // Consumos del camión: dos vigentes (la más nueva con producto de stock) y una anulada; otro equipo y otra faena aparte.
  await testDb.insert(schema.inventoryMovements).values({
    id: "mov-ep-1", worksiteId: IDS.wsBio, productId: "p-ep-1", type: "egreso_mantencion", quantity: 1,
    referenceType: "mant_record", referenceId: "r-ep-2", stockBefore: 3, stockAfter: 2, performedBy: IDS.mecBio, performedAt: NOW,
  })
  await insertRecord({ id: "r-ep-1", folio: "MC-BIO-0201", workDate: daysAgo(10) })
  await insertRecord({ id: "r-ep-2", folio: "MC-BIO-0202", workDate: daysAgo(3), registeredBy: IDS.mecBio2 })
  await insertRecord({ id: "r-ep-void", folio: "MC-BIO-0203", workDate: daysAgo(5), voided: true })
  await insertRecord({ id: "r-ep-other", folio: "MC-BIO-0204", vehicleId: IDS.machineBio, workDate: daysAgo(2) })
  await insertRecord({ id: "r-ep-cho", folio: "MC-CHO-0201", worksiteId: IDS.wsCho, registeredBy: IDS.mecCho, workDate: daysAgo(1) })
  await testDb.insert(schema.mantRecordParts).values([
    { id: "rp-1", recordId: "r-ep-1", quantity: 2, description: "Abrazaderas", sortOrder: 0 },
    { id: "rp-2", recordId: "r-ep-2", quantity: 1, description: "Bomba de agua", sortOrder: 0, productId: "p-ep-1", source: "stock", stockStatus: "descontado", inventoryMovementId: "mov-ep-1" },
    { id: "rp-3", recordId: "r-ep-2", quantity: 4, description: "Correa del ventilador", sortOrder: 1, productId: "p-ep-1", source: "stock", stockStatus: "pendiente_conciliar", stockNote: "Faltó stock al sincronizar" },
    { id: "rp-void", recordId: "r-ep-void", quantity: 9, description: "Anulada: no cuenta", sortOrder: 0 },
    { id: "rp-other", recordId: "r-ep-other", quantity: 1, description: "De otra máquina", sortOrder: 0 },
    { id: "rp-cho", recordId: "r-ep-cho", quantity: 1, description: "Hecho en Cholguán", sortOrder: 0 },
  ])
})

describe("notas del equipo", () => {
  it("lista la nota de la OT del equipo y la que le carga una línea, y deja fuera las que no son suyas", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckBio, jefe)
    expect(notes?.total).toBe(2)
    // De la más nueva a la más antigua.
    expect(notes?.rows.map((note) => note.code)).toEqual(["NP-2026-0002", "NP-2026-0001"])
  })

  it("la nota de la OT trae todas sus líneas, su OT, su estado y su urgencia", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckBio, jefe)
    const note = notes!.rows.find((row) => row.code === "NP-2026-0001")!
    expect(note).toMatchObject({ id: "n-1", status: "en_gestion", urgent: true, workOrderId: OT_ID, workOrderFolio: "OT-EP-1", otherChargeLines: 0 })
    expect(note.lines.map((line) => [line.description, line.quantity, line.resolution])).toEqual([
      ["Filtro hidráulico", 2, "pendiente"],
      ["Sello de pluma", 1, "en_compra"],
    ])
  })

  it("una nota sin OT que carga una línea al equipo trae sólo esa línea y cuenta las otras como de otro cargo", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckBio, jefe)
    const note = notes!.rows.find((row) => row.code === "NP-2026-0002")!
    expect(note).toMatchObject({ workOrderId: null, workOrderFolio: null, status: "aceptada", otherChargeLines: 2 })
    expect(note.lines.map((line) => line.description)).toEqual(["Cable de acero"])
  })

  it("cada línea aparece en la ficha de un solo equipo: la otra línea de la nota sin OT está en la ficha de la máquina", async () => {
    const machine = await loadEquipmentParts(IDS.machineBio, jefe)
    expect(machine.notes?.rows.map((note) => [note.code, note.lines.map((line) => line.description), note.otherChargeLines])).toEqual([["NP-2026-0002", ["Guantes de cuero"], 2]])
  })

  it("una nota de la OT cuyas líneas se cargan a un centro de costo no es del equipo", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckBio, jefe)
    expect(notes?.rows.map((note) => note.code)).not.toContain("NP-2026-0003")
  })

  it("un equipo sin notas devuelve una lista vacía, no nula", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckAra, jefe)
    expect(notes).toEqual({ rows: [], total: 0 })
  })
})

describe("notas del equipo: alcance de lectura", () => {
  it("el supervisor de la faena las ve; el de otra faena no ve ninguna", async () => {
    expect((await loadEquipmentParts(IDS.truckBio, supBio)).notes?.rows.map((note) => note.code)).toEqual(["NP-2026-0002", "NP-2026-0001"])
    expect((await loadEquipmentParts(IDS.truckBio, supAra)).notes).toEqual({ rows: [], total: 0 })
  })

  it("con sólo `mant:np:view_own` ve únicamente las notas que pidió él", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckBio, mecBio)
    // Javier pidió N1; N2 la pidió Alexis y `view_own` no da alcance de faena.
    expect(notes?.rows.map((note) => note.code)).toEqual(["NP-2026-0001"])
  })

  it("quien no tiene permiso de notas recibe `null` (no «sin notas») y sigue viendo lo que sí puede", async () => {
    const { notes } = await loadEquipmentParts(IDS.truckBio, viewer(IDS.mecCho, ["mant:records:view_all"], [], true))
    expect(notes).toBeNull()
    expect((await loadEquipmentParts(IDS.truckBio, plain))).toEqual({ notes: null, consumptions: null })
  })
})

describe("consumos del equipo", () => {
  it("lista las líneas de registros vigentes del equipo, de la más reciente a la más antigua, con su estado de stock", async () => {
    const { consumptions } = await loadEquipmentParts(IDS.truckBio, jefe)
    expect(consumptions?.total).toBe(4)
    expect(consumptions?.rows.map((row) => [row.recordFolio, row.description, row.stockStatus, row.source])).toEqual([
      ["MC-CHO-0201", "Hecho en Cholguán", "no_aplica", "texto"],
      ["MC-BIO-0202", "Bomba de agua", "descontado", "stock"],
      ["MC-BIO-0202", "Correa del ventilador", "pendiente_conciliar", "stock"],
      ["MC-BIO-0201", "Abrazaderas", "no_aplica", "texto"],
    ])
  })

  it("trae el producto de catálogo (SKU y unidad), el registro y la fecha del trabajo", async () => {
    const { consumptions } = await loadEquipmentParts(IDS.truckBio, jefe)
    const row = consumptions!.rows.find((item) => item.id === "rp-3")!
    expect(row).toMatchObject({
      recordId: "r-ep-2", recordKind: "C", workDate: daysAgo(3), quantity: 4, sku: "REP-EP-1", unitOfMeasure: "unidad",
      stockNote: "Faltó stock al sincronizar",
    })
    const free = consumptions!.rows.find((item) => item.id === "rp-1")!
    expect(free).toMatchObject({ sku: null, unitOfMeasure: null, stockNote: null })
  })

  it("no cuenta los registros anulados ni los de otro equipo", async () => {
    const { consumptions } = await loadEquipmentParts(IDS.truckBio, jefe)
    const descriptions = consumptions!.rows.map((row) => row.description)
    expect(descriptions).not.toContain("Anulada: no cuenta")
    expect(descriptions).not.toContain("De otra máquina")
  })

  it("respeta el alcance de lectura de registros: la hoja de vida sigue al equipo y el mecánico sólo ve lo propio", async () => {
    // KA-135 está HOY en Biodiversa: su supervisor ve también el registro hecho en Cholguán.
    expect((await loadEquipmentParts(IDS.truckBio, supBio)).consumptions?.rows.map((row) => row.recordFolio)).toEqual(["MC-CHO-0201", "MC-BIO-0202", "MC-BIO-0202", "MC-BIO-0201"])
    // Javier registró MC-BIO-0201; el 0202 lo registró otro mecánico y el de Cholguán no es suyo.
    expect((await loadEquipmentParts(IDS.truckBio, mecBio)).consumptions?.rows.map((row) => row.recordFolio)).toEqual(["MC-BIO-0201"])
    expect((await loadEquipmentParts(IDS.truckBio, supAra)).consumptions?.total).toBe(0)
  })

  it("quien no puede leer registros recibe `null`, aunque pueda ver notas", async () => {
    const { notes, consumptions } = await loadEquipmentParts(IDS.truckBio, viewer(IDS.supBio, ["mant:np:view_worksite"], [IDS.wsBio]))
    expect(consumptions).toBeNull()
    expect(notes?.total).toBe(2)
  })
})

describe("tope de filas", () => {
  it("trae las últimas `limit` y dice cuántas hay en total", async () => {
    const page = await loadEquipmentParts(IDS.truckBio, jefe, { limit: 1 })
    expect(page.notes?.rows.map((note) => note.code)).toEqual(["NP-2026-0002"])
    expect(page.notes?.total).toBe(2)
    expect(page.consumptions?.rows).toHaveLength(1)
    expect(page.consumptions?.total).toBe(4)
  })

  it("el tope por omisión es de 50", () => {
    expect(EQUIPMENT_PARTS_LIMIT).toBe(50)
  })
})
