import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
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

const { getFuelLogTotal, getFuelLogRows, getFuelLogRowsBySelection } = await import("@/lib/combustibles/fuel-log")

/**
 * Prueba de integración PostgreSQL del read model de la bitácora general
 * (sección 19, "Filtros y bitácora") — `fuel-log.ts` no tenía ninguna prueba.
 * Cubre combinación de filtros, alcance de faena, paginación, ordenamiento
 * y selección manual, contra las dos fuentes con datos reales (TAE y
 * facturación); el log operacional queda fuera por alcance — requeriría
 * además `fuel_operation_batches`, sin agregar cobertura nueva al mecanismo
 * (ya lo comparte con las otras dos ramas vía el mismo `unionAll`).
 */
function globalSession(): Session {
  return {
    user: { id: "user-1", name: "Global", email: "global@example.com", roles: ["administrador"], permissions: [], worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: { id: "user-2", name: "Scoped", email: "scoped@example.com", roles: ["solicitante_faena"], permissions: [], worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

describe("fuel-log read model (PostgreSQL integration)", () => {
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const productId = nanoid()
  const supplierX = nanoid()
  const supplierY = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const userId = nanoid()
  const taeEarly = nanoid()
  const taeLate = nanoid()
  const loadX = nanoid()
  const loadY = nanoid()
  const loadInB = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importador", email: `import-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values([
      { id: supplierX, name: "Copec" },
      { id: supplierY, name: "Shell" },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `CC${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true })

    // 2 cargas TAE en faena A, en orden cronológico distinto.
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      {
        id: taeEarly, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
        worksiteId: worksiteA, vehicleId, productId, equipmentCodeSnapshot: "CC-1",
        loadedAt: "2026-06-01T08:00:00.000Z", submittedAt: "2026-06-01T08:00:00.000Z",
        driverNameSnapshot: "Conductor 1", supervisorNameSnapshot: "Supervisor 1", meterType: "odometer",
        liters: 40, status: "submitted",
      },
      {
        id: taeLate, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
        worksiteId: worksiteA, vehicleId, productId, equipmentCodeSnapshot: "CC-1",
        loadedAt: "2026-06-05T08:00:00.000Z", submittedAt: "2026-06-05T08:00:00.000Z",
        driverNameSnapshot: "Conductor 2", supervisorNameSnapshot: "Supervisor 2", meterType: "odometer",
        liters: 60, status: "submitted",
      },
    ])
    // 2 facturas en faena A con proveedores distintos, 1 factura en faena B.
    await inMemoryDb.insert(schema.fuelLoads).values([
      { id: loadX, loadDate: "2026-06-02", month: "2026-06", serviceType: "TCT", vehicleId, fuelSupplierId: supplierX, worksiteId: worksiteA, product: "PETROLEO DIESEL", productId, liters: 100, baseAmount: 1000, totalAmount: 1190, createdBy: userId },
      { id: loadY, loadDate: "2026-06-03", month: "2026-06", serviceType: "TCT", vehicleId, fuelSupplierId: supplierY, worksiteId: worksiteA, product: "PETROLEO DIESEL", productId, liters: 80, baseAmount: 800, totalAmount: 952, createdBy: userId },
      { id: loadInB, loadDate: "2026-06-04", month: "2026-06", serviceType: "TCT", vehicleId, fuelSupplierId: supplierX, worksiteId: worksiteB, product: "PETROLEO DIESEL", productId, liters: 50, baseAmount: 500, totalAmount: 595, createdBy: userId },
    ])
  })

  it("sin filtros, una sesión global ve las 5 filas de faena A + faena B (2 TAE + 3 facturas)", async () => {
    const total = await getFuelLogTotal(globalSession(), {})
    expect(total).toBe(5)
  })

  it("aplica el alcance de faena: una sesión acotada a A no ve la factura de B", async () => {
    const total = await getFuelLogTotal(scopedSession([worksiteA]), {})
    expect(total).toBe(4)
    const rows = await getFuelLogRows(scopedSession([worksiteA]), {}, { limit: 50, offset: 0, sort: "desc" })
    expect(rows.every((r) => r.worksiteName === "Faena A")).toBe(true)
  })

  it("combina el filtro de fuente con el de faena", async () => {
    const total = await getFuelLogTotal(globalSession(), { worksiteId: worksiteA, source: "tae_pwa" })
    expect(total).toBe(2)
  })

  it("filtra por proveedor exacto (sólo aplica a la rama de facturación)", async () => {
    const rows = await getFuelLogRows(globalSession(), { supplierId: supplierX }, { limit: 50, offset: 0, sort: "desc" })
    expect(rows).toHaveLength(2) // loadX (faena A) + loadInB (faena B)
    expect(rows.every((r) => r.supplierId === supplierX)).toBe(true)
  })

  it("pagina en servidor: limit=1 devuelve una sola fila sin importar el total", async () => {
    const rows = await getFuelLogRows(globalSession(), {}, { limit: 1, offset: 0, sort: "desc" })
    expect(rows).toHaveLength(1)
    const total = await getFuelLogTotal(globalSession(), {})
    expect(total).toBe(5)
  })

  it("ordena en servidor por fecha de ocurrencia, asc y desc", async () => {
    const desc = await getFuelLogRows(globalSession(), { worksiteId: worksiteA, source: "tae_pwa" }, { limit: 50, offset: 0, sort: "desc" })
    expect(desc[0]!.id).toBe(taeLate)
    const asc = await getFuelLogRows(globalSession(), { worksiteId: worksiteA, source: "tae_pwa" }, { limit: 50, offset: 0, sort: "asc" })
    expect(asc[0]!.id).toBe(taeEarly)
  })

  it("acciones masivas: getFuelLogRowsBySelection devuelve exactamente las filas seleccionadas, cruzando fuentes", async () => {
    const rows = await getFuelLogRowsBySelection(globalSession(), [
      { source: "tae_pwa", id: taeEarly },
      { source: "invoiced", id: loadY },
    ])
    expect(rows.map((r) => r.id).sort()).toEqual([loadY, taeEarly].sort())
  })
})

/**
 * Filtros del rediseño de «Cargas a equipos» (2026-10-31): `como` (cómo llegó),
 * `estado`, «sólo con algo pendiente», `equipo`, y los campos nuevos de cada fila
 * (origen, equipo, la fila proyectada y su marca). Datos propios en una faena
 * aparte: los conteos de arriba no cambian.
 */
describe("fuel-log: cómo llegó, estado y pendiente (PostgreSQL integration)", () => {
  const worksiteC = nanoid()
  const userId = nanoid()
  const productId = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const otherVehicleId = nanoid()
  const batchId = nanoid()
  const supplierId = nanoid()
  const taeQr = nanoid()
  const taeApp = nanoid()
  const taeHistorico = nanoid()
  const invoiceRegistered = nanoid()
  const invoiceDraft = nanoid()
  const operationRecord = nanoid()
  const equipmentLoadQr = nanoid()
  const markOpenInvoice = nanoid()
  const markWithdrawnHistorico = nanoid()
  const markWithdrawnQr = nanoid()
  const FILTER = { worksiteId: worksiteC }
  const PAGE = { limit: 50, offset: 0, sort: "desc" as const }

  function tae(id: string, source: "public_pwa" | "internal_app" | "legacy_xlsx", status: string, loadedAt: string, extra: Record<string, unknown> = {}) {
    return {
      id, clientSubmissionId: nanoid(), source, publicResultToken: nanoid(32),
      worksiteId: worksiteC, vehicleId, productId, equipmentCodeSnapshot: "CA-14",
      loadedAt, submittedAt: loadedAt, driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor",
      meterType: "odometer", liters: 40, status, ...extra,
    }
  }

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteC, name: "Faena C", code: `FC-${nanoid().slice(0, 8)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Ana", email: `ana-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `D-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `cam-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: `Copec ${nanoid().slice(0, 4)}` })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehicleId, plate: `CA${nanoid().slice(0, 4).toUpperCase()}`, code: "CA-14", type: "camion", equipmentTypeId, worksiteId: worksiteC, isActive: true },
      { id: otherVehicleId, plate: `CB${nanoid().slice(0, 4).toUpperCase()}`, code: "CB-02", type: "camion", equipmentTypeId, worksiteId: worksiteC, isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      tae(taeQr, "public_pwa", "submitted", "2026-10-05T12:00:00.000Z", { removedSealNumber: "1", installedSealNumber: null }),
      tae(taeApp, "internal_app", "observed", "2026-10-06T12:00:00.000Z", { registeredBy: userId, removedSealNumber: "2", installedSealNumber: "3" }),
      tae(taeHistorico, "legacy_xlsx", "validated", "2026-10-07T12:00:00.000Z", { removedSealNumber: "3", installedSealNumber: "4" }),
    ])
    await inMemoryDb.insert(schema.fuelLoads).values([
      { id: invoiceRegistered, loadDate: "2026-10-08", month: "2026-10", serviceType: "TCT", vehicleId, fuelSupplierId: supplierId, worksiteId: worksiteC, product: "PETROLEO DIESEL", productId, liters: 100, baseAmount: 1000, totalAmount: 1190, status: "registered", createdBy: userId },
      { id: invoiceDraft, loadDate: "2026-10-09", month: "2026-10", serviceType: "TCT", vehicleId: otherVehicleId, fuelSupplierId: supplierId, worksiteId: worksiteC, product: "PETROLEO DIESEL", productId, liters: 80, baseAmount: 800, totalAmount: 952, status: "draft", createdBy: userId },
    ])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "consolidado.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", importadoPor: userId,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values({
      id: operationRecord, batchId, worksiteId: worksiteC, vehicleId, plate: "OPKM99", fecha: "2026-10-10", liters: 50, rendimiento: 3.1, tipoRendimiento: "km_lt",
    })
    // La plataforma dejó la carga del QR por decidir (lectura menor a la anterior).
    await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
      id: equipmentLoadQr, source: "field", taeSubmissionId: taeQr, vehicleId, worksiteId: worksiteC,
      occurredAt: "2026-10-05T12:00:00.000Z", month: "2026-10", liters: 40,
      reviewStatus: "flagged", flagReasons: ["meter_regression"],
    })
    await inMemoryDb.insert(schema.fuelReviewMarks).values([
      { id: markOpenInvoice, entityType: "fuel_load", entityId: invoiceDraft, worksiteId: worksiteC, markedBy: userId, notes: "Los litros parecen altos", status: "open" },
      // Un pedido retirado o resuelto ya no marca la fila.
      { id: markWithdrawnHistorico, entityType: "fuel_tae_submission", entityId: taeHistorico, worksiteId: worksiteC, markedBy: userId, notes: "Pedido retirado", status: "withdrawn" },
      { id: markWithdrawnQr, entityType: "fuel_tae_submission", entityId: taeQr, worksiteId: worksiteC, markedBy: userId, notes: "Pedido resuelto", status: "resolved" },
    ])
  })

  it("sin filtros de origen trae las tres fuentes, cada fila con su «cómo llegó»", async () => {
    const rows = await getFuelLogRows(globalSession(), FILTER, PAGE)
    expect(rows).toHaveLength(6)
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.origin]))
    expect(byId).toEqual({
      [taeQr]: "qr", [taeApp]: "app", [taeHistorico]: "historico",
      [invoiceRegistered]: "factura", [invoiceDraft]: "factura", [operationRecord]: "planilla",
    })
  })

  it("`como` con varios orígenes (qr, app, histórico) deja sólo los registros en terreno", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, origins: ["qr", "app", "historico"] }, PAGE)
    expect(rows.map((row) => row.id).sort()).toEqual([taeQr, taeApp, taeHistorico].sort())
    expect(await getFuelLogTotal(globalSession(), { ...FILTER, origins: ["qr", "app", "historico"] })).toBe(3)
  })

  it("`como` distingue el formulario por QR, la app y el histórico dentro de terreno", async () => {
    expect((await getFuelLogRows(globalSession(), { ...FILTER, origins: ["app"] }, PAGE)).map((row) => row.id)).toEqual([taeApp])
    expect((await getFuelLogRows(globalSession(), { ...FILTER, origins: ["qr"] }, PAGE)).map((row) => row.id)).toEqual([taeQr])
    expect((await getFuelLogRows(globalSession(), { ...FILTER, origins: ["historico"] }, PAGE)).map((row) => row.id)).toEqual([taeHistorico])
  })

  it("`como` mezcla orígenes de tablas distintas: app + factura + planilla", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, origins: ["app", "factura", "planilla"] }, PAGE)
    expect(rows.map((row) => row.id).sort()).toEqual([taeApp, invoiceRegistered, invoiceDraft, operationRecord].sort())
  })

  it("`estado` en palabras: por validar, con observación, validada, borrador", async () => {
    const ids = async (stateSlug: Parameters<typeof getFuelLogRows>[1]["stateSlug"]) =>
      (await getFuelLogRows(globalSession(), { ...FILTER, stateSlug }, PAGE)).map((row) => row.id)
    expect(await ids("por-validar")).toEqual([taeQr])
    expect(await ids("con-observacion")).toEqual([taeApp])
    expect(await ids("validada")).toEqual([taeHistorico])
    expect(await ids("borrador")).toEqual([invoiceDraft])
    expect(await ids("registrada")).toEqual([invoiceRegistered])
  })

  it("la planilla no tiene estado: un `estado` no la trae, y un origen sin ese estado no deja ninguna fila", async () => {
    expect((await getFuelLogRows(globalSession(), { ...FILTER, stateSlug: "registrada" }, PAGE)).map((row) => row.id)).not.toContain(operationRecord)
    expect(await getFuelLogTotal(globalSession(), { ...FILTER, origins: ["planilla"], stateSlug: "validada" })).toBe(0)
    expect(await getFuelLogRows(globalSession(), { ...FILTER, origins: ["factura"], stateSlug: "validada" }, PAGE)).toEqual([])
  })

  it("«sólo con algo pendiente»: por decidir, con observación y pedido abierto; un pedido retirado o resuelto no cuenta", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, onlyPending: true }, PAGE)
    expect(rows.map((row) => row.id).sort()).toEqual([taeQr, taeApp, invoiceDraft].sort())
    expect(rows.map((row) => row.id)).not.toContain(taeHistorico)
    expect(await getFuelLogTotal(globalSession(), { ...FILTER, onlyPending: true })).toBe(3)
  })

  it("«sólo con algo pendiente» también trae la fila con un caso de anomalía abierto, y la columna lo cuenta", async () => {
    const ruleId = nanoid()
    const caseId = nanoid()
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({ id: ruleId, code: `regla-${ruleId}`, name: "Regla de prueba" })
    await inMemoryDb.insert(schema.fuelAnomalyCases).values({
      id: caseId, ruleId, ruleCode: `regla-${ruleId}`, description: "Caso abierto de prueba",
      referenceEntityType: "fuel_operation_record", referenceEntityId: operationRecord, status: "open",
    })
    try {
      const rows = await getFuelLogRows(globalSession(), { ...FILTER, onlyPending: true }, PAGE)
      expect(rows.map((row) => row.id).sort()).toEqual([taeQr, taeApp, invoiceDraft, operationRecord].sort())
      expect(rows.find((row) => row.id === operationRecord)?.anomalyCount).toBe(1)
      expect(await getFuelLogTotal(globalSession(), { ...FILTER, onlyPending: true })).toBe(4)
    } finally {
      await inMemoryDb.delete(schema.fuelAnomalyCases).where(eq(schema.fuelAnomalyCases.id, caseId))
      await inMemoryDb.delete(schema.fuelAnomalyRules).where(eq(schema.fuelAnomalyRules.id, ruleId))
    }
  })

  it("trae la fila proyectada y su motivo, y sólo marca el pedido abierto", async () => {
    const rows = await getFuelLogRows(globalSession(), FILTER, PAGE)
    const qr = rows.find((row) => row.id === taeQr)!
    expect(qr).toMatchObject({ equipmentLoadId: equipmentLoadQr, reviewFlagged: true, reviewFlagReason: "meter_regression", vehicleId, worksiteId: worksiteC })
    // El pedido del QR está resuelto: la fila no queda marcada.
    expect(qr.reviewMark).toBeNull()
    const draft = rows.find((row) => row.id === invoiceDraft)!
    expect(draft).toMatchObject({ reviewMark: true, reviewMarkId: markOpenInvoice, reviewMarkNotes: "Los litros parecen altos", reviewMarkedBy: userId, equipmentLoadId: null, reviewFlagged: null })
    expect(rows.find((row) => row.id === taeHistorico)!.reviewMark).toBeNull()
  })

  it("el filtro antiguo «sólo marcados para revisión» cuenta sólo el pedido abierto", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, hasReviewMark: true }, PAGE)
    expect(rows.map((row) => row.id)).toEqual([invoiceDraft])
  })

  it("`mias=si` (registradas por mí) deja sólo las de terreno que registró esa persona y se combina con `estado`", async () => {
    const mine = await getFuelLogRows(globalSession(), { ...FILTER, registeredBy: userId }, PAGE)
    expect(mine.map((row) => row.id)).toEqual([taeApp])
    expect((await getFuelLogRows(globalSession(), { ...FILTER, registeredBy: userId, stateSlug: "con-observacion" }, PAGE)).map((row) => row.id)).toEqual([taeApp])
    expect(await getFuelLogTotal(globalSession(), { ...FILTER, registeredBy: userId, stateSlug: "validada" })).toBe(0)
    expect(await getFuelLogTotal(globalSession(), { ...FILTER, registeredBy: "otra-persona" })).toBe(0)
  })

  it("filtra por equipo (`equipo`) en las tres fuentes", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, vehicleId }, PAGE)
    expect(rows.map((row) => row.id).sort()).toEqual([taeQr, taeApp, taeHistorico, invoiceRegistered, operationRecord].sort())
    expect((await getFuelLogRows(globalSession(), { ...FILTER, vehicleId: otherVehicleId }, PAGE)).map((row) => row.id)).toEqual([invoiceDraft])
  })

  it("sello incompleto: sólo registros en terreno con el retirado o el instalado sin informar", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, sealIncomplete: true }, PAGE)
    expect(rows.map((row) => row.id)).toEqual([taeQr])
  })

  it("menos de 4 fotos: los tres registros en terreno sin fotos; facturas y planilla no aplican", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, photosIncomplete: true }, PAGE)
    expect(rows.map((row) => row.id).sort()).toEqual([taeQr, taeApp, taeHistorico].sort())
  })

  it("el período (desde/hasta) acota las tres fuentes por su fecha civil", async () => {
    const rows = await getFuelLogRows(globalSession(), { ...FILTER, from: "2026-10-06", to: "2026-10-08" }, PAGE)
    expect(rows.map((row) => row.id).sort()).toEqual([taeApp, taeHistorico, invoiceRegistered].sort())
  })

  it("el alcance de faena sigue mandando con los filtros nuevos", async () => {
    expect(await getFuelLogTotal(scopedSession([worksiteC]), { ...FILTER, origins: ["qr"] })).toBe(1)
    expect(await getFuelLogTotal(scopedSession([nanoid()]), { ...FILTER, onlyPending: true, origins: ["qr", "app", "historico", "factura", "planilla"] })).toBe(0)
  })

  it("cuenta y filas coinciden con la paginación del filtro nuevo", async () => {
    const filters = { ...FILTER, origins: ["qr", "app", "historico"] as Array<"qr" | "app" | "historico"> }
    const total = await getFuelLogTotal(globalSession(), filters)
    const first = await getFuelLogRows(globalSession(), filters, { limit: 2, offset: 0, sort: "desc" })
    const second = await getFuelLogRows(globalSession(), filters, { limit: 2, offset: 2, sort: "desc" })
    expect(total).toBe(3)
    expect([...first, ...second].map((row) => row.id)).toEqual([taeHistorico, taeApp, taeQr])
  })

  it("una carga registrada después (fecha pasada) tiene las fotos opcionales: no cuenta como «menos de 4 fotos»", async () => {
    const backdated = nanoid()
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values(tae(backdated, "internal_app", "submitted", "2026-10-02T12:00:00.000Z", {
      registeredBy: userId, loadedAtSource: "backdated", backdateReason: "Se olvidó registrarla ese día",
    }))
    const incomplete = await getFuelLogRows(globalSession(), { ...FILTER, photosIncomplete: true }, PAGE)
    expect(incomplete.map((row) => row.id)).not.toContain(backdated)
    expect(incomplete.map((row) => row.id).sort()).toEqual([taeQr, taeApp, taeHistorico].sort())
    // …pero sí aparece en la lista normal, con su origen.
    const all = await getFuelLogRows(globalSession(), { ...FILTER, origins: ["app"] }, PAGE)
    expect(all.map((row) => row.id)).toContain(backdated)
  })
})
