/**
 * Catálogo de repuestos (fase 2, 2026-11-09): servicio `spare-parts-catalog`
 * contra Postgres real (PGlite con todas las migraciones, incluida la 0385 que
 * siembra la categoría «Repuestos» y el índice único por N° de parte + marca).
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const catalog = await import("@/lib/services/spare-parts-catalog")
const { setProductSupplierPriceTx } = await import("@/lib/services/product-supplier-prices")

const now = new Date().toISOString()

async function createPart(input: Partial<Parameters<typeof catalog.createSparePartTx>[1]> & { name: string }) {
  return testDb.transaction((tx) => catalog.createSparePartTx(tx as unknown as Tx, {
    unitOfMeasure: "unidad", createdByUserId: IDS.jefe, ...input,
  }))
}

async function requestFor(id: string, productId: string, vehicleId: string, opts: { requestStatus?: string; createdAt?: string } = {}) {
  await testDb.insert(schema.purchaseRequests).values({
    id: `r-${id}`, code: `REP-${id}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
    status: opts.requestStatus ?? "approved", urgency: "normal", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: `i-${id}`, requestId: `r-${id}`, productId, quantity: 1, unitOfMeasure: "unidad", status: "approved",
    vehicleId, createdAt: opts.createdAt ?? now, updatedAt: now,
  })
}

async function orderFor(id: string, requestItemId: string | null, productId: string | null, over: Partial<typeof schema.purchaseOrders.$inferInsert> = {}) {
  await testDb.insert(schema.purchaseOrders).values({
    id: `oc-${id}`, code: `OC-${id}`, worksiteId: IDS.wsBio, supplierId: "sup-a", createdBy: IDS.jefe, status: "sent",
    deliveryMode: "directo_faena", createdAt: now, updatedAt: now, ...over,
  })
  await testDb.insert(schema.purchaseOrderItems).values({
    id: `oc-${id}-line`, purchaseOrderId: `oc-${id}`, requestItemId, productId, quantity: 1, unitOfMeasure: "unidad",
    unitPrice: 15_000, subtotal: 15_000, sortOrder: 0,
  })
}

describe("catálogo de repuestos", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    // truckBio y truckAra quedan Scania R450 (fixture); truckCho pasa a Volvo FH.
    await testDb.update(schema.fuelVehicles).set({ brand: "Volvo", model: "FH" }).where(eq(schema.fuelVehicles.id, IDS.truckCho))
    await testDb.insert(schema.suppliers).values([
      { id: "sup-a", name: "Repuestos del Sur", rut: "76.000.111-1", isActive: true, createdAt: now, updatedAt: now },
      { id: "sup-b", name: "Frenos Bío Bío", rut: "76.000.222-2", isActive: true, createdAt: now, updatedAt: now },
    ])
  })

  afterAll(async () => {
    await pg.close()
  })

  it("siembra la categoría Repuestos y numera los SKU RPT-NNN en secuencia", async () => {
    const [category] = await testDb.select().from(schema.productCategories).where(eq(schema.productCategories.slug, "repuestos"))
    expect(category).toMatchObject({ name: "Repuestos", isEpp: false })

    const first = await createPart({ name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar" })
    const second = await createPart({ name: "Pastilla de freno", partNumber: "PF-200" })
    expect(first.sku).toBe("RPT-001")
    expect(second.sku).toBe("RPT-002")

    const [row] = await testDb.select().from(schema.products).where(eq(schema.products.id, first.id))
    expect(row).toMatchObject({
      isSparePart: true, isEpp: false, isService: false, isActive: true,
      categoryId: category!.id, partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad",
    })
  })

  it("rechaza un N° de parte repetido para la misma marca, sin importar mayúsculas", async () => {
    await expect(createPart({ name: "Otro filtro", partNumber: "1r-0750", partBrand: "CATERPILLAR" }))
      .rejects.toThrow("Ya existe el repuesto RPT-001 con ese N° de parte")
    // Sin marca contra sin marca también choca.
    await expect(createPart({ name: "Pastilla duplicada", partNumber: "pf-200" }))
      .rejects.toThrow("Ya existe el repuesto RPT-002 con ese N° de parte")
    // Mismo número, otra marca: es otro repuesto.
    const otherBrand = await createPart({ name: "Filtro de aceite Fleetguard", partNumber: "1R-0750", partBrand: "Fleetguard" })
    expect(otherBrand.sku).toBe("RPT-003")
    // Editar hacia un número ocupado también se rechaza.
    await expect(catalog.updateSparePart(otherBrand.id, {
      name: "Filtro de aceite Fleetguard", partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad",
    }, IDS.jefe)).rejects.toThrow("Ya existe el repuesto RPT-001 con ese N° de parte")
  })

  it("si otra alta del mismo N° de parte gana la carrera, el error dice cuál es el repuesto", async () => {
    // Sin la revisión previa: el índice único es quien rechaza el INSERT.
    const [category] = await testDb.select().from(schema.productCategories).where(eq(schema.productCategories.slug, "repuestos"))
    await expect(testDb.transaction((tx) => catalog.insertSparePartRowTx(tx as unknown as Tx, {
      id: "rpt-carrera", sku: "RPT-950", categoryId: category!.id,
      data: { name: "Filtro duplicado", partNumber: "1R-0750", partBrand: "caterpillar", unitOfMeasure: "unidad", notes: null, referencePrice: null },
    }))).rejects.toThrow("Ya existe el repuesto RPT-001 con ese N° de parte")
    const [ghost] = await testDb.select().from(schema.products).where(eq(schema.products.id, "rpt-carrera"))
    expect(ghost).toBeUndefined()
  })

  it("otro choque único (un SKU repetido) no se disfraza de N° de parte repetido", async () => {
    const [category] = await testDb.select().from(schema.productCategories).where(eq(schema.productCategories.slug, "repuestos"))
    const attempt = testDb.transaction((tx) => catalog.insertSparePartRowTx(tx as unknown as Tx, {
      id: "rpt-sku-carrera", sku: "RPT-001", categoryId: category!.id,
      data: { name: "Otro repuesto", partNumber: "SKU-CHOQUE-1", partBrand: null, unitOfMeasure: "unidad", notes: null, referencePrice: null },
    }))
    await expect(attempt).rejects.toThrow()
    await expect(attempt).rejects.not.toThrow(/N° de parte/)
  })

  it("valida nombre y unidad activa", async () => {
    await expect(createPart({ name: "   " })).rejects.toThrow(/nombre/)
    await expect(createPart({ name: "Correa", unitOfMeasure: "no-existe" })).rejects.toThrow(/catálogo de unidades/)
  })

  it("encuentra por N° de parte (con y sin marca) sólo entre activos", async () => {
    expect(await catalog.findSparePartByPartNumber("1R-0750", "caterpillar")).toMatchObject({ sku: "RPT-001" })
    expect(await catalog.findSparePartByPartNumber("PF-200")).toMatchObject({ sku: "RPT-002" })
    expect(await catalog.findSparePartByPartNumber("NO-EXISTE")).toBeNull()
  })

  it("excluye los inactivos por defecto y los muestra con includeInactive", async () => {
    const retired = await createPart({ name: "Alternador antiguo", partNumber: "ALT-9" })
    await catalog.setSparePartActive(retired.id, false, IDS.jefe)

    const active = await catalog.listSpareParts()
    expect(active.map((part) => part.id)).not.toContain(retired.id)
    const all = await catalog.listSpareParts({ includeInactive: true })
    expect(all.find((part) => part.id === retired.id)).toMatchObject({ isActive: false })
    expect(await catalog.findSparePartByPartNumber("ALT-9")).toBeNull()
  })

  it("busca por nombre sin tildes, SKU y N° de parte sin guiones", async () => {
    await createPart({ name: "Válvula de alivio", partNumber: "VA-77" })
    expect((await catalog.listSpareParts({ query: "valvula" })).map((part) => part.name)).toEqual(["Válvula de alivio"])
    expect((await catalog.listSpareParts({ query: "rpt-002" })).map((part) => part.sku)).toEqual(["RPT-002"])
    expect((await catalog.listSpareParts({ query: "1r0750" })).map((part) => part.sku).sort()).toEqual(["RPT-001", "RPT-003"])
  })

  it("busca varias palabras en cualquier orden, cada una en cualquier campo", async () => {
    expect((await catalog.listSpareParts({ query: "aceite filtro" })).map((part) => part.sku).sort()).toEqual(["RPT-001", "RPT-003"])
    expect((await catalog.listSpareParts({ query: "  filtro   caterpillar " })).map((part) => part.sku)).toEqual(["RPT-001"])
    expect((await catalog.listSpareParts({ query: "aceite 1r0750 fleetguard" })).map((part) => part.sku)).toEqual(["RPT-003"])
    expect(await catalog.listSpareParts({ query: "aceite freno" })).toEqual([])
  })

  it("busca también por marca del repuesto y con tope informa el total", async () => {
    expect((await catalog.listSpareParts({ query: "CATERPILLAR" })).map((part) => part.sku)).toEqual(["RPT-001"])
    expect((await catalog.listSpareParts({ query: "VÁLVULA" })).map((part) => part.name)).toEqual(["Válvula de alivio"])
    // Un comodín de LIKE escrito por la persona es texto literal.
    expect(await catalog.listSpareParts({ query: "%" })).toEqual([])

    const everything = await catalog.searchSpareParts()
    const limited = await catalog.searchSpareParts({ limit: 2 })
    expect(limited.parts).toHaveLength(2)
    expect(limited.total).toBe(everything.parts.length)
    expect(limited.parts.map((part) => part.id)).toEqual(everything.parts.slice(0, 2).map((part) => part.id))
  })

  it("con vehículo: primero lo comprado para él, luego para su marca/modelo, luego el resto alfabético", async () => {
    const forVehicle = await createPart({ name: "Zapata de freno", partNumber: "ZF-1" })
    const forModel = await createPart({ name: "Yugo de dirección", partNumber: "YD-1" })
    const forOther = await createPart({ name: "Bomba de agua", partNumber: "BA-1" })
    const cancelled = await createPart({ name: "Cable de embrague", partNumber: "CE-1" })

    await requestFor("veh", forVehicle.id, IDS.truckBio)
    await orderFor("veh", "i-veh", forVehicle.id)
    // truckAra es Scania R450 igual que truckBio.
    await requestFor("mod", forModel.id, IDS.truckAra)
    await orderFor("mod", "i-mod", forModel.id)
    // truckCho es Volvo FH: no suma.
    await requestFor("oth", forOther.id, IDS.truckCho)
    await orderFor("oth", "i-oth", forOther.id)
    // Una solicitud anulada para el mismo vehículo no cuenta como «comprado para».
    await requestFor("can", cancelled.id, IDS.truckBio, { requestStatus: "cancelled" })
    await orderFor("can", "i-can", cancelled.id)

    const ranked = await catalog.listSpareParts({ vehicleId: IDS.truckBio })
    expect(ranked[0]).toMatchObject({ id: forVehicle.id, vehicleMatch: "vehicle", vehicleCount: 1, purchasedForVehicleIds: [IDS.truckBio] })
    expect(ranked[1]).toMatchObject({ id: forModel.id, vehicleMatch: "model" })
    const rest = ranked.slice(2)
    expect(rest.every((part) => part.vehicleMatch === null)).toBe(true)
    expect(rest.map((part) => part.name)).toEqual([...rest.map((part) => part.name)].sort((a, b) => a.localeCompare(b, "es-CL")))
    expect(rest.find((part) => part.id === cancelled.id)).toMatchObject({ vehicleCount: 0, purchasedForVehicleIds: [] })

    // La lista inicial del buscador: sólo lo comprado para el vehículo o su modelo.
    const initial = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, onlyVehicleMatches: true, limit: 30 })
    expect(initial.parts.map((part) => [part.id, part.vehicleMatch])).toEqual([[forVehicle.id, "vehicle"], [forModel.id, "model"]])
    expect(initial.total).toBe(2)
    expect(await catalog.searchSpareParts({ onlyVehicleMatches: true })).toEqual({ parts: [], total: 0 })

    // Con tope, el orden por vehículo se aplica antes de cortar.
    const top = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, limit: 1 })
    expect(top.parts.map((part) => part.id)).toEqual([forVehicle.id])

    // Por id (lo que una solicitud ya referencia), con sus vehículos.
    const byId = await catalog.listSpareParts({ ids: [forOther.id] })
    expect(byId).toEqual([expect.objectContaining({ id: forOther.id, purchasedForVehicleIds: [IDS.truckCho], vehicleMatch: null })])
    expect(await catalog.listSpareParts({ ids: [] })).toEqual([])

    // Sin vehículo: alfabético puro.
    const plain = await catalog.listSpareParts()
    expect(plain.map((part) => part.name)).toEqual([...plain.map((part) => part.name)].sort((a, b) => a.localeCompare(b, "es-CL")))
    expect(plain.every((part) => part.vehicleMatch === null)).toBe(true)
  })

  it("con alcance de faenas: «mismo modelo» sólo cuenta equipos de esas faenas", async () => {
    const mine = await createPart({ name: "Perno de rueda", partNumber: "PR-SC-1" })
    const other = await createPart({ name: "Tuerca de rueda", partNumber: "TR-SC-1" })
    await requestFor("scope-mine", mine.id, IDS.truckBio)
    await orderFor("scope-mine", "i-scope-mine", mine.id)
    // truckAra es Scania R450 como truckBio, pero de otra faena (Arauco).
    await requestFor("scope-other", other.id, IDS.truckAra)
    await orderFor("scope-other", "i-scope-other", other.id)

    // Sin alcance (global) el equipo de Arauco cuenta como «mismo modelo».
    const unscoped = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, onlyVehicleMatches: true, query: "rueda" })
    expect(unscoped.parts.map((part) => [part.id, part.vehicleMatch])).toEqual([[mine.id, "vehicle"], [other.id, "model"]])

    // Con sólo Biodiversa, el parque de Arauco no ordena ni filtra.
    const scoped = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, onlyVehicleMatches: true, query: "rueda", vehicleScope: [IDS.wsBio] })
    expect(scoped.parts.map((part) => [part.id, part.vehicleMatch])).toEqual([[mine.id, "vehicle"]])
    const ranked = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, query: "rueda", vehicleScope: [IDS.wsBio] })
    expect(ranked.parts.find((part) => part.id === other.id)?.vehicleMatch).toBeNull()

    // Un equipo fuera del alcance no da orden ninguno.
    const outside = await catalog.searchSpareParts({ vehicleId: IDS.truckAra, onlyVehicleMatches: true, vehicleScope: [IDS.wsBio] })
    expect(outside).toEqual({ parts: [], total: 0 })
  })

  it("pedirlo no es comprarlo: sin OC emitida no cuenta, y la solicitud en curso se puede excluir", async () => {
    const pending = await createPart({ name: "Sensor de temperatura", partNumber: "ST-1" })
    const drafted = await createPart({ name: "Sensor de presión", partNumber: "SP-1" })
    const voided = await createPart({ name: "Sensor de nivel", partNumber: "SN-1" })
    const bought = await createPart({ name: "Sensor de velocidad", partNumber: "SV-1" })
    // Sólo pedido, sin OC.
    await requestFor("sen-pend", pending.id, IDS.truckBio)
    // OC en borrador: todavía no se compró.
    await requestFor("sen-draft", drafted.id, IDS.truckBio)
    await orderFor("sen-draft", "i-sen-draft", drafted.id, { status: "draft" })
    // OC anulada: no se compró.
    await requestFor("sen-void", voided.id, IDS.truckBio)
    await orderFor("sen-void", "i-sen-void", voided.id, { status: "cancelled" })
    // OC emitida: sí.
    await requestFor("sen-sent", bought.id, IDS.truckBio)
    await orderFor("sen-sent", "i-sen-sent", bought.id, { status: "sent" })

    const ranked = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, query: "sensor" })
    const match = Object.fromEntries(ranked.parts.map((part) => [part.id, part.vehicleMatch]))
    expect(match).toEqual({ [pending.id]: null, [drafted.id]: null, [voided.id]: null, [bought.id]: "vehicle" })
    expect(ranked.parts[0]!.id).toBe(bought.id)
    const counts = Object.fromEntries(ranked.parts.map((part) => [part.id, part.vehicleCount]))
    expect(counts).toEqual({ [pending.id]: 0, [drafted.id]: 0, [voided.id]: 0, [bought.id]: 1 })
    expect((await catalog.getSparePartDetail(pending.id))!.purchasedFor).toEqual([])

    // La solicitud que se está convirtiendo en OC no se cuenta a sí misma.
    const excluded = await catalog.searchSpareParts({ vehicleId: IDS.truckBio, query: "sensor", excludeRequestId: "r-sen-sent" })
    expect(excluded.parts.find((part) => part.id === bought.id)?.vehicleMatch).toBeNull()
  })

  it("la línea de OC vinculada al repuesto también cuenta como «comprado para»", async () => {
    const part = await createPart({ name: "Rodamiento", partNumber: "RD-1" })
    // La solicitud se pidió en texto libre; Compras catalogó la línea en la OC.
    await testDb.insert(schema.purchaseRequests).values({
      id: "r-free", code: "REP-free", worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
      status: "approved", urgency: "normal", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.purchaseRequestItems).values({
      id: "i-free", requestId: "r-free", productNameFree: "Rodamiento rueda", quantity: 1, unitOfMeasure: "unidad",
      status: "purchased", vehicleId: IDS.truckCho, createdAt: now, updatedAt: now,
    })
    await orderFor("free", "i-free", part.id, { issuedAt: "2026-11-05T10:00:00.000Z" })

    const [listed] = await catalog.listSpareParts({ query: "RD-1" })
    expect(listed).toMatchObject({ vehicleCount: 1, purchasedForVehicleIds: [IDS.truckCho], lastPurchasedAt: "2026-11-05T10:00:00.000Z" })
  })

  it("ficha: proveedores, historial de precio más reciente primero, comprado para y últimas líneas", async () => {
    const part = await createPart({ name: "Disco de freno", partNumber: "DF-9", partBrand: "Brembo" })
    await testDb.transaction(async (tx) => {
      await setProductSupplierPriceTx(tx as never, {
        productId: part.id, supplierId: "sup-a", unitPrice: 10_000, source: "product_form",
        effectiveAt: "2026-10-01T12:00:00.000Z", userId: IDS.jefe, isPreferred: true,
      })
      await setProductSupplierPriceTx(tx as never, {
        productId: part.id, supplierId: "sup-a", unitPrice: 12_500, source: "purchase_order", sourceId: "oc-df-2",
        effectiveAt: "2026-11-02T12:00:00.000Z", userId: IDS.jefe,
      })
      await setProductSupplierPriceTx(tx as never, {
        productId: part.id, supplierId: "sup-b", unitPrice: 11_000, source: "invoice_reconciliation",
        effectiveAt: "2026-10-15T12:00:00.000Z",
      })
    })

    await requestFor("df-1", part.id, IDS.truckBio, { createdAt: "2026-10-20T12:00:00.000Z" })
    await orderFor("df-1", "i-df-1", part.id, { issuedAt: "2026-10-21T12:00:00.000Z" })
    await requestFor("df-2", part.id, IDS.truckBio, { createdAt: "2026-11-01T12:00:00.000Z" })
    await requestFor("df-3", part.id, IDS.truckAra, { createdAt: "2026-11-03T12:00:00.000Z" })
    await orderFor("df-3", "i-df-3", part.id, { status: "draft" })

    const detail = await catalog.getSparePartDetail(part.id)
    expect(detail).not.toBeNull()
    expect(detail!.part).toMatchObject({ sku: part.sku, name: "Disco de freno", partNumber: "DF-9", partBrand: "Brembo", isActive: true })

    expect(detail!.suppliers[0]).toMatchObject({ supplierId: "sup-a", supplierName: "Repuestos del Sur", unitPrice: 12_500, isPreferred: true })
    expect(detail!.suppliers).toHaveLength(2)

    expect(detail!.priceHistory.map((entry) => entry.newPrice)).toEqual([12_500, 11_000, 10_000])
    expect(detail!.priceHistory[0]).toMatchObject({ source: "purchase_order", sourceId: "oc-df-2", previousPrice: 10_000, createdByName: "Alexis Morales" })

    // Sólo lo comprado con OC emitida: df-2 sólo se pidió y df-3 tiene la OC en borrador.
    expect(detail!.purchasedFor).toEqual([
      expect.objectContaining({ vehicleId: IDS.truckBio, vehicleCode: "KA-135", vehiclePlate: "RBYD-98", vehicleBrand: "Scania", vehicleModel: "R450", requestCount: 1 }),
    ])

    // «Últimas solicitudes» sí muestra lo pedido y el borrador.
    expect(detail!.recentLines.map((line) => line.requestCode).sort()).toEqual(["REP-df-1", "REP-df-2", "REP-df-3"])
    expect(detail!.recentLines.find((line) => line.requestCode === "REP-df-1")).toMatchObject({
      orderCode: "OC-df-1", orderStatus: "sent", supplierName: "Repuestos del Sur", unitPrice: 15_000, vehicleCode: "KA-135",
    })
    expect(detail!.recentLines.find((line) => line.requestCode === "REP-df-2")).toMatchObject({ orderId: null, orderCode: null })

    // Lista: el precio del preferido y la última OC emitida.
    const [listed] = await catalog.listSpareParts({ query: "DF-9" })
    expect(listed).toMatchObject({
      preferredSupplierId: "sup-a", preferredSupplierName: "Repuestos del Sur", lastPrice: 12_500, lastSupplierName: "Repuestos del Sur",
      lastPurchasedAt: "2026-10-21T12:00:00.000Z", vehicleCount: 1,
    })
  })

  it("lista: sin preferido dice el proveedor del último precio, y trae el precio de referencia", async () => {
    const part = await createPart({ name: "Manguera hidráulica", partNumber: "MH-1", referencePrice: 8_990 })
    const [bare] = await catalog.listSpareParts({ query: "MH-1" })
    expect(bare).toMatchObject({ preferredSupplierName: null, lastSupplierName: null, lastPrice: null, referencePrice: 8_990 })

    // Emitir una OC registra el precio con el proveedor, pero no lo marca preferido.
    await testDb.transaction(async (tx) => {
      await setProductSupplierPriceTx(tx as never, {
        productId: part.id, supplierId: "sup-b", unitPrice: 9_500, source: "purchase_order", sourceId: "oc-mh",
        effectiveAt: "2026-11-04T12:00:00.000Z", userId: IDS.jefe,
      })
    })
    const [priced] = await catalog.listSpareParts({ query: "MH-1" })
    expect(priced).toMatchObject({ preferredSupplierName: null, lastSupplierName: "Frenos Bío Bío", lastPrice: 9_500, referencePrice: 8_990 })
  })

  it("la ficha devuelve null para un id inexistente o un producto que no es repuesto", async () => {
    expect(await catalog.getSparePartDetail("no-existe")).toBeNull()
    await testDb.insert(schema.products).values({
      id: "prod-comun", sku: "PRD-900", name: "Guantes", categoryId: "cat-repuestos", unitOfMeasure: "unidad",
    })
    expect(await catalog.getSparePartDetail("prod-comun")).toBeNull()
  })

  it("el CHECK impide marcar como repuesto un EPP", async () => {
    await expect(testDb.insert(schema.products).values({
      id: "prod-epp-rpt", sku: "EPP-900", name: "Casco", categoryId: "cat-repuestos", unitOfMeasure: "unidad",
      isEpp: true, isSparePart: true,
    })).rejects.toThrow()
  })
})
