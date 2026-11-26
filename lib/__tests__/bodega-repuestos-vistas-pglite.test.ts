import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * NP · L7 — vistas de Bodega con repuestos (ADR mantención 0001): kárdex con la OT y el
 * registro, «Reservado OT» y «Libre», cobertura, trazabilidad, Excel de kárdex y de stock, y la
 * hoja «Repuestos» de la exportación de la OT. Contra Postgres de verdad (PGlite con todas las
 * migraciones): lo que importa vive en los joins y en el alcance.
 *
 * Datos (todos en la faena Biodiversa salvo lo indicado):
 *  - Filtro: 10 en bodega; la OT A reserva 4 desde su nota de pedido NP-2026-0001.
 *    R1 usa 1; R2 usa 2 y se anula; R3 pide 100 (no alcanza → pendiente de conciliar).
 *    Queda: stock 9, reservado 3, libre 6.
 *  - Aceite: 20 en bodega, sin reserva; R4 usa 3 (stock 17, libre 17).
 *  - Guante (no es repuesto): 50 en bodega.
 *  - Cholguán: aceite con 5 en bodega y 2 reservados para la OT C (otra faena).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))
const routeSession = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn(async () => routeSession.current) }))
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })),
  CredentialsSignin: class CredentialsSignin extends Error {},
}))

const parts = await import("@/lib/services/mantencion/parts")
const { applyMovementTx } = await import("@/lib/services/stock-movement")
const { listKardexMovements } = await import("@/lib/services/kardex-movements")
const { loadSpareStockLevels, stockLevelKey } = await import("@/lib/services/bodega-spare-stock")
const { getStockConsumption, stockConsumptionKey } = await import("@/lib/services/stock-coverage")
const { getKardexExport, getStockExport } = await import("@/lib/services/stock-export")
const { getItemDetail } = await import("@/lib/services/trazabilidad-item")
const { getStockAvailability, getIncomingWithoutStock } = await import("@/lib/services/stock-availability")
const { exportWorkOrders } = await import("@/lib/services/mantencion/work-orders/export")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { GET: getBodegaOptions } = await import("@/app/api/bodega/opciones/route")
const { NextRequest } = await import("next/server")

const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }
const OT = { a: "ot-l7-a", c: "ot-l7-c" } as const
const OT_FOLIO = { a: "OT-BIO-0001", c: "OT-CHO-0001" } as const
const P = { filter: "p-l7-filter", oil: "p-l7-oil", glove: "p-l7-glove", bolt: "p-l7-bolt" } as const
const NOTE = { id: "np-l7-1", itemId: "np-l7-1-item", code: "NP-2026-0001" } as const
const REQUEST = { id: "req-l7", item: "req-l7-item" } as const

const NOW = new Date().toISOString()

function globalSession() {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-global", name: "Usuario Global", email: "global@chome.cl", roles: ["administrador"],
      permissions: [], worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true,
    },
  }
}

function scopedSession(worksiteIds: string[]) {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-scoped", name: "Usuario Faena", email: "faena@chome.cl", roles: ["solicitante_faena"],
      permissions: [], worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true,
    },
  }
}

async function insertOt(id: string, folio: string, vehicleId: string, worksiteId: string) {
  await testDb.insert(schema.mantWorkOrders).values({
    id, folio, vehicleId, worksiteId, equipmentSnapshot: { ...SNAPSHOT, code: vehicleId === IDS.truckCho ? "KA-200" : "KA-135", plate: vehicleId === IDS.truckCho ? "BCDF-12" : "RBYD-98" },
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status: "en_ejecucion",
    assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
  })
}

let recordSeq = 0
async function insertRecord(workOrderId: string, vehicleId: string): Promise<{ id: string; folio: string }> {
  recordSeq += 1
  const id = `rec-l7-${recordSeq}`
  const folio = `C-L7-${recordSeq}`
  await testDb.insert(schema.mantRecords).values({
    id, folio, kind: "C", vehicleId, equipmentSnapshot: SNAPSHOT, worksiteId: IDS.wsBio,
    reading: 120_000 + recordSeq, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: `2026-11-03T16:00:${String(recordSeq).padStart(2, "0")}Z`, workOrderId,
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: id, workTypes: ["Mecánico"], oils: [], description: "Cambio de filtro", noParts: false, hours: 2, inWorkshop: false,
  })
  return { id, folio }
}

async function consumeLine(input: { recordId: string; workOrderId: string; productId: string; quantity: number }) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    const result = await parts.consumePartTx(tx, {
      recordId: input.recordId, workOrderId: input.workOrderId, recordWorksiteId: IDS.wsBio,
      productId: input.productId, quantity: input.quantity, actorUserId: IDS.mecBio,
    })
    await tx.insert(schema.mantRecordParts).values({
      id: `${input.recordId}-${input.productId}`, recordId: input.recordId, quantity: input.quantity, description: "repuesto", source: "stock",
      productId: input.productId, allocationId: result.allocationId, stockStatus: result.status,
      inventoryMovementId: result.status === "descontado" ? result.movementId : null,
      stockNote: result.status === "pendiente_conciliar" ? result.note : null,
    })
    return result
  })
}

async function ingress(productId: string, quantity: number, worksiteId: string = IDS.wsBio) {
  await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
    worksiteId, productId, type: "ingreso_oc", quantity, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed",
  }))
}

async function reserve(workOrderId: string, productId: string, quantity: number, worksiteId: string, extra: { noteItemId?: string } = {}) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { workOrderIds: [workOrderId], worksiteId, productIds: [productId] })
    return parts.addToAllocationTx(tx, {
      workOrderId, worksiteId, productId, quantity, source: "stock_existente", actorUserId: IDS.jefe, noteItemId: extra.noteItemId,
    })
  })
}

async function sheetRows(workbook: ExcelJS.Workbook, name: string): Promise<Array<Record<string, unknown>>> {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new Error(`Falta la hoja ${name}`)
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
  const rows: Array<Record<string, unknown>> = []
  sheet.eachRow((row, index) => {
    if (index === 1) return
    const values = (row.values as unknown[]).slice(1)
    rows.push(Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])))
  })
  return rows
}

let record1: { id: string; folio: string }
let record2: { id: string; folio: string }
let movements: { consume1: string; consume2: string; reversal2: string }

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  await testDb.insert(schema.suppliers).values({ id: "sup-l7", name: "Repuestos del Sur", rut: "76.000.333-3", isActive: true, createdAt: NOW, updatedAt: NOW })
  await testDb.insert(schema.productCategories).values({ id: "cat-l7", name: "Repuestos L7", slug: "repuestos-l7", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  await testDb.insert(schema.products).values([
    { id: P.filter, sku: "REP-L7-1", name: "Filtro de aceite", categoryId: "cat-l7", unitOfMeasure: "unidad", isSparePart: true, partNumber: "FA-1", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: P.oil, sku: "REP-L7-2", name: "Aceite hidráulico", categoryId: "cat-l7", unitOfMeasure: "litro", isSparePart: true, partNumber: "AH-2", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: P.glove, sku: "GEN-L7-3", name: "Guante", categoryId: "cat-l7", unitOfMeasure: "par", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: P.bolt, sku: "REP-L7-4", name: "Perno", categoryId: "cat-l7", unitOfMeasure: "unidad", isSparePart: true, partNumber: "PE-4", isActive: true, createdAt: NOW, updatedAt: NOW },
  ])
  await insertOt(OT.a, OT_FOLIO.a, IDS.truckBio, IDS.wsBio)
  await insertOt(OT.c, OT_FOLIO.c, IDS.truckCho, IDS.wsCho)

  await ingress(P.filter, 10)
  await ingress(P.oil, 20)
  await ingress(P.glove, 50)
  await ingress(P.oil, 5, IDS.wsCho)

  // La nota de pedido de la OT A, resuelta «desde stock»: de ahí nace la reserva.
  await testDb.insert(schema.mantPartsNotes).values({
    id: NOTE.id, code: NOTE.code, workOrderId: OT.a, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, requestedByUserId: IDS.mecBio, status: "cerrada",
  })
  await testDb.insert(schema.mantPartsNoteItems).values({
    id: NOTE.itemId, noteId: NOTE.id, description: "Filtro de aceite", quantity: 4, partNumber: "FA-1", productId: P.filter,
    resolution: "desde_stock", resolvedByUserId: IDS.jefe, resolvedAt: NOW, sortOrder: 0,
  })
  await reserve(OT.a, P.filter, 4, IDS.wsBio, { noteItemId: NOTE.itemId })
  await reserve(OT.c, P.oil, 2, IDS.wsCho)

  record1 = await insertRecord(OT.a, IDS.truckBio)
  const first = await consumeLine({ recordId: record1.id, workOrderId: OT.a, productId: P.filter, quantity: 1 })
  record2 = await insertRecord(OT.a, IDS.truckBio)
  const second = await consumeLine({ recordId: record2.id, workOrderId: OT.a, productId: P.filter, quantity: 2 })
  await testDb.transaction(async (raw) => {
    await parts.reverseRecordPartsTx(raw as unknown as Tx, { recordId: record2.id, actorUserId: IDS.jefe, reason: "Registro duplicado" })
  })
  const [line2] = await testDb.select().from(schema.mantRecordParts).where(eq(schema.mantRecordParts.recordId, record2.id))
  const record3 = await insertRecord(OT.a, IDS.truckBio)
  const third = await consumeLine({ recordId: record3.id, workOrderId: OT.a, productId: P.filter, quantity: 100 })
  const record4 = await insertRecord(OT.a, IDS.truckBio)
  await consumeLine({ recordId: record4.id, workOrderId: OT.a, productId: P.oil, quantity: 3 })
  if (first.status !== "descontado" || second.status !== "descontado") throw new Error("La siembra de consumos no descontó")
  if (third.status !== "pendiente_conciliar") throw new Error("R3 debía quedar pendiente de conciliar")
  movements = { consume1: first.movementId, consume2: second.movementId, reversal2: line2!.reversalMovementId! }

  await testDb.insert(schema.purchaseRequests).values({
    id: REQUEST.id, code: "SOL-L7-001", worksiteId: IDS.wsBio, requesterId: IDS.jefe, status: "approved", createdAt: NOW, updatedAt: NOW,
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: REQUEST.item, requestId: REQUEST.id, productId: P.filter, quantity: 4, unitOfMeasure: "unidad", status: "approved", createdAt: NOW, updatedAt: NOW,
  })
  // Un repuesto pedido y aprobado que aún no llega (para «Por recibir»).
  await testDb.insert(schema.purchaseRequestItems).values({
    id: "req-l7-bolt", requestId: REQUEST.id, productId: P.bolt, quantity: 6, unitOfMeasure: "unidad", status: "approved", createdAt: NOW, updatedAt: NOW,
  })
}, 120_000)

describe("kárdex: la OT y el registro de cada uso en mantención", () => {
  it("un egreso_mantencion trae el folio de la OT y del registro, en la misma consulta", async () => {
    const rows = await listKardexMovements({ where: undefined, limit: 100, offset: 0 })
    const use = rows.find((row) => row.id === movements.consume1)
    expect(use).toMatchObject({
      type: "egreso_mantencion", referenceType: "mant_record", referenceId: record1.id,
      workOrderId: OT.a, workOrderFolio: OT_FOLIO.a, recordFolio: record1.folio,
    })
  })

  it("el reverso por anulación del registro apunta a la misma OT y al mismo registro", async () => {
    const rows = await listKardexMovements({ where: undefined, limit: 100, offset: 0 })
    const reversal = rows.find((row) => row.id === movements.reversal2)
    expect(reversal).toMatchObject({
      type: "ingreso_anulacion", referenceType: "mant_record_void", referenceId: record2.id,
      workOrderFolio: OT_FOLIO.a, recordFolio: record2.folio,
    })
  })

  it("los demás movimientos no inventan OT ni registro", async () => {
    const rows = await listKardexMovements({ where: undefined, limit: 100, offset: 0 })
    const ingressRow = rows.find((row) => row.type === "ingreso_oc" && row.productId === P.glove)
    expect(ingressRow).toBeTruthy()
    expect(ingressRow).toMatchObject({ workOrderId: null, workOrderFolio: null, recordFolio: null })
  })

  it("respeta el filtro de alcance que le pasa la página y pagina sin repetir filas", async () => {
    const onlyCho = await listKardexMovements({ where: eq(schema.inventoryMovements.worksiteId, IDS.wsCho), limit: 100, offset: 0 })
    expect(onlyCho.length).toBeGreaterThan(0)
    expect(onlyCho.every((row) => row.worksiteId === IDS.wsCho)).toBe(true)
    const all = await listKardexMovements({ where: undefined, limit: 100, offset: 0 })
    const paged = [
      ...await listKardexMovements({ where: undefined, limit: 2, offset: 0 }),
      ...await listKardexMovements({ where: undefined, limit: 2, offset: 2 }),
    ]
    expect(paged.map((row) => row.id)).toEqual(all.slice(0, 4).map((row) => row.id))
  })
})

describe("stock: reservado y libre de un repuesto", () => {
  it("muestra lo reservado para las OT y lo libre, sólo en las filas de repuesto", async () => {
    const levels = await loadSpareStockLevels([
      { worksiteId: IDS.wsBio, productId: P.filter, quantity: 9, isSparePart: true },
      { worksiteId: IDS.wsBio, productId: P.oil, quantity: 17, isSparePart: true },
      { worksiteId: IDS.wsBio, productId: P.glove, quantity: 50, isSparePart: false },
    ])
    // Reserva de 4 con 1 usado (el uso anulado no cuenta): quedan 3 reservados y 6 libres.
    expect(levels.get(stockLevelKey(IDS.wsBio, P.filter))).toEqual({ reserved: 3, free: 6 })
    expect(levels.get(stockLevelKey(IDS.wsBio, P.oil))).toEqual({ reserved: 0, free: 17 })
    expect(levels.has(stockLevelKey(IDS.wsBio, P.glove))).toBe(false)
  })

  it("no trae reservas de otra faena ni consulta si no hay repuestos", async () => {
    const levels = await loadSpareStockLevels([{ worksiteId: IDS.wsBio, productId: P.oil, quantity: 17, isSparePart: true }])
    // La reserva de 2 de aceite es de Cholguán: no entra en la fila de Biodiversa.
    expect(levels.get(stockLevelKey(IDS.wsBio, P.oil))?.reserved).toBe(0)
    expect((await loadSpareStockLevels([{ worksiteId: IDS.wsBio, productId: P.glove, quantity: 50, isSparePart: false }])).size).toBe(0)
  })

  it("lo reservado nunca deja el libre en negativo", async () => {
    const levels = await loadSpareStockLevels([{ worksiteId: IDS.wsBio, productId: P.filter, quantity: 2, isSparePart: true }])
    expect(levels.get(stockLevelKey(IDS.wsBio, P.filter))).toEqual({ reserved: 3, free: 0 })
  })
})

describe("cobertura: el uso en mantención es una salida y su reverso la resta", () => {
  it("cuenta egreso_mantencion y descuenta el reverso del registro anulado", async () => {
    const rows = await getStockConsumption(globalSession() as never)
    // Filtro: usó 1 (R1) y 2 (R2); R2 se anuló y repuso 2 → consumo neto 1, en una salida neta.
    expect(rows.get(stockConsumptionKey(IDS.wsBio, P.filter))).toMatchObject({ consumed: 1, events: 1 })
    // Aceite: usó 3 y nada se anuló.
    expect(rows.get(stockConsumptionKey(IDS.wsBio, P.oil))).toMatchObject({ consumed: 3, events: 1 })
  })

  it("acotada a una faena sin permiso no devuelve el consumo de otra", async () => {
    const rows = await getStockConsumption(scopedSession([IDS.wsCho]) as never)
    expect(rows.has(stockConsumptionKey(IDS.wsBio, P.filter))).toBe(false)
  })
})

describe("por recibir: un repuesto es stock en tránsito a su faena", () => {
  it("lo incluye por defecto y se puede dejar fuera (la alerta de «sin stock con demanda» lo excluye)", async () => {
    const withSpare = await getStockAvailability(globalSession() as never, { worksiteId: IDS.wsBio })
    expect(withSpare).toContainEqual({ worksiteId: IDS.wsBio, productId: P.bolt, incoming: 6 })
    const without = await getStockAvailability(globalSession() as never, { worksiteId: IDS.wsBio, includeSpareParts: false })
    expect(without.some((row) => row.productId === P.bolt || row.productId === P.filter)).toBe(false)
  })

  it("lo pedido de un repuesto que la faena nunca tuvo aparece en la tabla de stock", async () => {
    const rows = await getStockAvailability(globalSession() as never, { worksiteId: IDS.wsBio })
    const withoutRecord = await getIncomingWithoutStock(rows)
    expect(withoutRecord).toContainEqual(expect.objectContaining({ productId: P.bolt, incoming: 6, productName: "Perno" }))
  })
})

describe("trazabilidad del producto: de cada egreso por mantención a su OT, registro y NP", () => {
  it("el egreso trae la OT, el registro y la nota de pedido que alimentó la reserva", async () => {
    const detail = await getItemDetail(globalSession() as never, REQUEST.item)
    const use = detail?.inventoryMovements.find((row) => row.id === movements.consume1)
    expect(use?.maintenance).toEqual({
      workOrderId: OT.a, workOrderFolio: OT_FOLIO.a, recordId: record1.id, recordFolio: record1.folio, noteCodes: [NOTE.code],
    })
  })

  it("el reverso por anulación lleva lo mismo; un ingreso no lleva nada", async () => {
    const detail = await getItemDetail(globalSession() as never, REQUEST.item)
    const reversal = detail?.inventoryMovements.find((row) => row.id === movements.reversal2)
    expect(reversal?.maintenance).toMatchObject({ workOrderFolio: OT_FOLIO.a, recordFolio: record2.folio, noteCodes: [NOTE.code] })
    const ingressRow = detail?.inventoryMovements.find((row) => row.type === "ingreso_oc")
    expect(ingressRow?.maintenance).toBeNull()
  })

  it("sin nota de pedido deja la OT y el registro y la NP vacía", async () => {
    // El aceite se usó sin pasar por una NP.
    await testDb.insert(schema.purchaseRequestItems).values({
      id: "req-l7-oil", requestId: REQUEST.id, productId: P.oil, quantity: 1, unitOfMeasure: "litro", status: "approved", createdAt: NOW, updatedAt: NOW,
    })
    const detail = await getItemDetail(globalSession() as never, "req-l7-oil")
    const use = detail?.inventoryMovements.find((row) => row.type === "egreso_mantencion")
    expect(use?.maintenance).toMatchObject({ workOrderFolio: OT_FOLIO.a, noteCodes: [] })
  })
})

describe("Excel del kárdex y del stock", () => {
  it("el kárdex lleva la OT y el registro en las filas de mantención, y rotula el reverso", async () => {
    const result = await getKardexExport(globalSession() as never, { productId: P.filter, worksiteId: IDS.wsBio })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.buffer) as never)
    const rows = await sheetRows(workbook, "Kardex")
    const use = rows.find((row) => row["Registro de mantención"] === record1.folio)
    expect(use).toMatchObject({ "Tipo de movimiento": "Uso en mantención", OT: OT_FOLIO.a })
    const reversal = rows.find((row) => row["Registro de mantención"] === record2.folio && row["Tipo de movimiento"] !== "Uso en mantención")
    expect(reversal).toMatchObject({ "Tipo de movimiento": "Reverso de uso en mantención", OT: OT_FOLIO.a })
    const ingressRow = rows.find((row) => row["Tipo de movimiento"] === "Ingreso OC")
    expect(ingressRow).toMatchObject({ OT: "", "Registro de mantención": "" })
  })

  it("el stock lleva Reservado OT y Libre sólo en los repuestos", async () => {
    const result = await getStockExport(globalSession() as never, { worksiteId: IDS.wsBio })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.buffer) as never)
    const rows = await sheetRows(workbook, "Stock")
    const filter = rows.find((row) => row.SKU === "REP-L7-1")
    expect(filter).toMatchObject({ "En bodega": 9, "Reservado OT": 3, Libre: 6 })
    const glove = rows.find((row) => row.SKU === "GEN-L7-3")
    expect(glove).toMatchObject({ "En bodega": 50, "Reservado OT": "", Libre: "" })
  })
})

describe("opciones de ajuste, baja y conteo: los repuestos entran (inventario de arranque)", () => {
  async function options(worksiteId: string, permissions: string[]) {
    routeSession.current = { ...globalSession(), user: { ...globalSession().user, permissions } }
    const response = await getBodegaOptions(new NextRequest(`http://localhost/api/bodega/opciones?faena=${worksiteId}`))
    return { status: response.status, body: await response.json() as { products: Array<{ productId: string; quantity: number }> } }
  }

  it("ofrece los repuestos con su saldo, junto a los productos de siempre", async () => {
    const { status, body } = await options(IDS.wsBio, ["warehouse:adjust_stock"])
    expect(status).toBe(200)
    const byId = new Map(body.products.map((product) => [product.productId, product.quantity]))
    // Un repuesto con saldo y otro que la faena nunca tuvo (el arranque lo carga con un ajuste).
    expect(byId.get(P.filter)).toBe(9)
    expect(byId.has(P.bolt)).toBe(true)
    expect(byId.get(P.glove)).toBe(50)
  })

  it("sigue exigiendo permiso de ajuste de stock", async () => {
    expect((await options(IDS.wsBio, ["warehouse:view_stock"])).status).toBe(403)
  })
})

describe("exportación de la OT: hoja «Repuestos»", () => {
  async function adminSession(userId: string) {
    const rbac = await getUserRbacById(userId, true)
    if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
    return { user: { id: rbac.id, email: rbac.email, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: [] } }
  }

  async function exportedWorkbook(userId: string) {
    const outcome = await exportWorkOrders({ session: await adminSession(userId) as never, filters: { tab: "abiertas" } })
    if (!outcome.ok) throw new Error(outcome.message)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    return workbook
  }

  it("trae por OT y repuesto la NP, lo pedido, lo reservado, lo usado y lo pendiente de conciliar", async () => {
    const workbook = await exportedWorkbook(IDS.adminBio)
    const rows = await sheetRows(workbook, "Repuestos")
    const filter = rows.find((row) => row.Repuesto === "Filtro de aceite")
    expect(filter).toMatchObject({
      Folio: OT_FOLIO.a, Faena: "Biodiversa", Equipo: "KA-135", NP: NOTE.code,
      Pedido: 4, Reservado: 4, Usado: 1, Liberado: 0, "Pendiente de conciliar": 100,
    })
    const oil = rows.find((row) => row.Repuesto === "Aceite hidráulico")
    expect(oil).toMatchObject({ Folio: OT_FOLIO.a, NP: "", Pedido: 0, Reservado: 0, Usado: 3, "Pendiente de conciliar": 0 })
  })

  it("respeta el alcance: quien ve Biodiversa no ve los repuestos de la OT de Cholguán", async () => {
    const workbook = await exportedWorkbook(IDS.adminBio)
    const rows = await sheetRows(workbook, "Repuestos")
    expect(rows.some((row) => row.Folio === OT_FOLIO.c)).toBe(false)
    const cho = await sheetRows(await exportedWorkbook(IDS.adminCho), "Repuestos")
    expect(cho.find((row) => row.Folio === OT_FOLIO.c)).toMatchObject({ Repuesto: "Aceite hidráulico", Reservado: 2, Usado: 0 })
    expect(cho.some((row) => row.Folio === OT_FOLIO.a)).toBe(false)
  })

  it("el consumo y la reserva siguen intactos después de exportar", async () => {
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations)
      .where(and(eq(schema.mantPartsAllocations.workOrderId, OT.a), eq(schema.mantPartsAllocations.productId, P.filter)))
    expect(Number(allocation?.quantity)).toBe(4)
  })
})
