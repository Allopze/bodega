import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── PostgreSQL en memoria con las migraciones reales ──────────────────────
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

// Los cargadores de la ficha miran permisos con `can`; la sesión de la prueba ya trae los suyos.
vi.mock("@/lib/auth/can", async () => {
  const scope = await import("@/lib/auth/scope")
  const has = (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission) ?? false
  return { can: has, canAny: (session: Session | null, ...permissions: string[]) => permissions.some((permission) => has(session, permission)), isGlobalRole: scope.isGlobalRole }
})

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getFuelLogRows, getFuelLogTotal, getFuelLogRowsBySelection, operationPerformanceUnitCode } = await import("@/lib/combustibles/fuel-log")
const { getTaeGroupedTotals } = await import("@/lib/combustibles/tae-dashboard")
const { loadTerrenoDetail, loadPlanillaDetail, loadFacturaDetail, loadHistory } = await import("@/lib/combustibles/fuel-log-detail")

/**
 * D-10 (datos personales) y D-11 (filtro de unidad de rendimiento) de la
 * bitácora, contra PostgreSQL real. Lo importante: el enmascarado ocurre en el
 * resultado de la consulta (no solo en la UI) y los filtros por nombre no se
 * pueden usar de oráculo sin el permiso.
 */
function session(permissions: string[]): Session {
  return {
    user: { id: "user-1", name: "U", email: "u@example.com", roles: ["administrador"], permissions, worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}
const withPersonal = () => session(["combustibles:view", "combustibles:view_personal"])
const withoutPersonal = () => session(["combustibles:view"])
const PAGE = { limit: 50, offset: 0, sort: "desc" as const }

describe("bitácora: datos personales y unidad de rendimiento (PostgreSQL)", () => {
  const worksiteId = nanoid()
  const userId = nanoid()
  const productId = nanoid()
  const vehicleId = nanoid()
  const equipmentTypeId = nanoid()
  const taeId = nanoid()
  const batchId = nanoid()
  const opKm = nanoid()
  const opHr = nanoid()

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Importador", email: `i-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `D-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `PP${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId, isActive: true })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: taeId, clientSubmissionId: nanoid(), source: "public_pwa", publicResultToken: nanoid(32),
      worksiteId, vehicleId, productId, equipmentCodeSnapshot: "CC-1",
      loadedAt: "2026-06-01T08:00:00.000Z", submittedAt: "2026-06-01T08:00:00.000Z",
      driverNameSnapshot: "Ana Conductora", supervisorNameSnapshot: "Luis Supervisor", meterType: "odometer",
      liters: 40, status: "submitted",
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "log.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", importadoPor: userId,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      { id: opKm, batchId, worksiteId, plate: "OPKM11", fecha: "2026-06-02", liters: 50, operador: "Pedro Operador", supervisor: "Marta Jefa", rendimiento: 3.1, tipoRendimiento: "km_lt" },
      { id: opHr, batchId, worksiteId, plate: "OPHR22", fecha: "2026-06-03", liters: 30, operador: "Rosa Operadora", supervisor: "Marta Jefa", rendimiento: 12, tipoRendimiento: "lt_hr" },
    ])
  })

  describe("D-10: enmascarado en el resultado de la consulta", () => {
    it("con view_personal devuelve los nombres de las dos fuentes con personas", async () => {
      const rows = await getFuelLogRows(withPersonal(), {}, PAGE)
      const names = rows.flatMap((r) => [r.driverName, r.supervisorName]).filter(Boolean)
      expect(names).toEqual(expect.arrayContaining(["Ana Conductora", "Luis Supervisor", "Pedro Operador", "Marta Jefa"]))
    })

    it("sin view_personal TODAS las filas traen conductor y supervisor en null", async () => {
      const rows = await getFuelLogRows(withoutPersonal(), {}, PAGE)
      expect(rows).toHaveLength(3)
      expect(rows.every((r) => r.driverName === null && r.supervisorName === null)).toBe(true)
      expect(JSON.stringify(rows)).not.toMatch(/Conductora|Supervisor|Operador|Marta|Rosa/)
    })

    it("la selección manual (exportar seleccionadas) también viene enmascarada", async () => {
      const rows = await getFuelLogRowsBySelection(withoutPersonal(), [{ source: "tae_pwa", id: taeId }, { source: "operation_manual", id: opKm }])
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.driverName === null && r.supervisorName === null)).toBe(true)
    })

    it("sin view_personal el filtro por nombre no actúa (no sirve de oráculo)", async () => {
      const unfiltered = await getFuelLogTotal(withoutPersonal(), {})
      expect(await getFuelLogTotal(withoutPersonal(), { driverName: "Ana" })).toBe(unfiltered)
      expect(await getFuelLogTotal(withoutPersonal(), { supervisorName: "inexistente-xyz" })).toBe(unfiltered)
    })

    it("sin view_personal la búsqueda de texto no mira nombres", async () => {
      expect(await getFuelLogTotal(withoutPersonal(), { q: "Ana Conductora" })).toBe(0)
      expect(await getFuelLogTotal(withoutPersonal(), { q: "Marta" })).toBe(0)
      // …pero sí encuentra por patente.
      expect(await getFuelLogTotal(withoutPersonal(), { q: "OPKM11" })).toBe(1)
    })

    it("con view_personal el filtro y la búsqueda por nombre siguen funcionando", async () => {
      expect(await getFuelLogTotal(withPersonal(), { driverName: "Ana" })).toBe(1)
      expect(await getFuelLogTotal(withPersonal(), { supervisorName: "Marta" })).toBe(2)
      expect(await getFuelLogTotal(withPersonal(), { q: "Pedro" })).toBe(1)
    })

    it("tae-dashboard: sin view_personal conserva litros y cargas pero rotula 'Reservado N'", async () => {
      const range = { from: "2026-06-01", to: "2026-06-30" }
      const real = await getTaeGroupedTotals(withPersonal(), range, "supervisor")
      expect(real).toEqual([{ group: "Luis Supervisor", liters: 40, count: 1 }])
      const masked = await getTaeGroupedTotals(withoutPersonal(), range, "supervisor")
      expect(masked).toEqual([{ group: "Reservado 1", liters: 40, count: 1 }])
      const maskedDrivers = await getTaeGroupedTotals(withoutPersonal(), range, "driver")
      expect(maskedDrivers.map((g) => g.group)).toEqual(["Reservado 1"])
      expect(JSON.stringify(maskedDrivers)).not.toContain("Ana")
    })
  })

  describe("D-11: filtro de unidad de rendimiento", () => {
    it("mapea el vocabulario del filtro al del log operacional", () => {
      expect(operationPerformanceUnitCode("km_per_liter")).toBe("km_lt")
      expect(operationPerformanceUnitCode("liters_per_hour")).toBe("lt_hr")
    })

    it("km_per_liter ya no descarta el log operacional: devuelve la fila km_lt", async () => {
      const rows = await getFuelLogRows(withPersonal(), { performanceUnit: "km_per_liter", source: "operation_manual" }, PAGE)
      expect(rows.map((r) => r.id)).toEqual([opKm])
    })

    it("liters_per_hour devuelve la fila lt_hr", async () => {
      const rows = await getFuelLogRows(withPersonal(), { performanceUnit: "liters_per_hour", source: "operation_manual" }, PAGE)
      expect(rows.map((r) => r.id)).toEqual([opHr])
    })

    it("en la vista unificada el filtro conserva las filas del log operacional", async () => {
      expect(await getFuelLogTotal(withPersonal(), { performanceUnit: "km_per_liter" })).toBeGreaterThanOrEqual(1)
    })
  })
})

/**
 * La ficha única de una carga (`/combustibles/cargas/[origen]/[id]`): lo que lee
 * cada cargador respeta el alcance de faena y los permisos de datos personales,
 * costos y auditoría ANTES de llegar a la pantalla (D-10, P-01): lo que no se
 * puede ver no sale de la consulta.
 */
describe("ficha de una carga: alcance y datos sensibles (PostgreSQL)", () => {
  const worksiteId = nanoid()
  const otherWorksiteId = nanoid()
  const userId = nanoid()
  const auditorId = nanoid()
  const productId = nanoid()
  const supplierId = nanoid()
  const equipmentTypeId = nanoid()
  const vehicleId = nanoid()
  const batchId = nanoid()
  const taeId = nanoid()
  const recordId = nanoid()
  const recordNoWorksiteId = nanoid()
  const invoiceId = nanoid()
  const equipmentLoadId = nanoid()
  const markId = nanoid()

  const sessionFor = (permissions: string[], options: { global?: boolean; worksiteIds?: string[] } = {}): Session => ({
    user: {
      id: userId, name: "U", email: "u@example.com", roles: [], permissions: ["combustibles:view", ...permissions],
      worksiteIds: options.worksiteIds ?? [worksiteId], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: options.global ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session)

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena Ficha", code: `FF-${nanoid().slice(0, 8)}`, isActive: true },
      { id: otherWorksiteId, name: "Faena Ajena", code: `FX-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values([
      { id: userId, name: "Ana Revisora", email: `ana-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
      { id: auditorId, name: "Luis Auditor", email: `luis-${nanoid()}@example.com`, hashedPassword: "x", isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `D-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: `Copec ${nanoid().slice(0, 4)}` })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `cam-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `FI${nanoid().slice(0, 4).toUpperCase()}`, code: "CA-14", type: "camion", equipmentTypeId, worksiteId, isActive: true })
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
      id: taeId, clientSubmissionId: nanoid(), source: "internal_app", publicResultToken: nanoid(32), registeredBy: userId,
      worksiteId, vehicleId, productId, equipmentCodeSnapshot: "CA-14", loadedAt: "2026-10-05T12:00:00.000Z", submittedAt: "2026-10-05T12:00:00.000Z",
      driverNameSnapshot: "Marcelo Conductor", supervisorNameSnapshot: "Rodrigo Supervisor", meterType: "odometer", meterReading: 182310, liters: 185, status: "observed", reviewNote: "Falta la foto",
    })
    await inMemoryDb.insert(schema.fuelTaeEvidence).values([
      { id: nanoid(), submissionId: taeId, kind: "odometer", fileName: "tablero.jpg" },
      { id: nanoid(), submissionId: taeId, kind: "liter_meter", fileName: "medidor.jpg" },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentLoads).values({
      id: equipmentLoadId, source: "field", taeSubmissionId: taeId, vehicleId, worksiteId, occurredAt: "2026-10-05T12:00:00.000Z", month: "2026-10", liters: 185,
      reviewStatus: "flagged", flagReasons: ["meter_regression"],
    })
    await inMemoryDb.insert(schema.statusHistory).values([
      { id: nanoid(), entityType: "fuel_tae_submission", entityId: taeId, fromStatus: null, toStatus: "submitted", changedBy: null },
      { id: nanoid(), entityType: "fuel_tae_submission", entityId: taeId, fromStatus: "submitted", toStatus: "observed", changedBy: userId, reason: "Falta la foto" },
    ])
    await inMemoryDb.insert(schema.fuelReviewMarks).values({ id: markId, entityType: "fuel_tae_submission", entityId: taeId, worksiteId, markedBy: auditorId, notes: "Revisar los litros", status: "open" })
    await inMemoryDb.insert(schema.auditLog).values([
      { id: nanoid(), userId, userEmail: "u@example.com", action: "update", entityType: "fuel_tae_submission", entityId: taeId, oldState: '{"meterReading":1000}', newState: '{"meterReading":182310}', reason: "Corrección" },
      { id: nanoid(), userId, userEmail: "u@example.com", action: "update", entityType: "fuel_load", entityId: invoiceId, oldState: '{"liters":100,"totalAmount":119000}', newState: '{"liters":120,"totalAmount":142800}' },
    ])
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId, archivoNombre: "consolidado.xlsx", hashArchivo: nanoid(), estado: "importado",
      periodoDesde: "2026-10-01", periodoHasta: "2026-10-31", importadoPor: userId, totalFilas: 10, filasInvalidas: 2,
    })
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      {
        id: recordId, batchId, worksiteId, vehicleId, plate: "OPKM11", code: "CA-14", fecha: "2026-10-10", horaCarga: "08:30", liters: 50, operador: "Pedro Operador", supervisor: "Marta Jefa",
        monto: 55000, precioLitro: 1100, proveedorNombre: "Copec", rendimiento: 3.1, tipoRendimiento: "km_lt", horometro: 5000, medidoPor: "km",
        rawRow: { FECHA: "2026-10-10", OPERADOR: "Pedro Operador", "MONTO TOTAL": 55000, PATENTE: "OPKM11" },
      },
      { id: recordNoWorksiteId, batchId, worksiteId: null, plate: "OPSIN1", fecha: "2026-10-11", liters: 30 },
    ])
    await inMemoryDb.insert(schema.fuelLoads).values({
      id: invoiceId, loadDate: "2026-10-08", month: "2026-10", serviceType: "TCT", vehicleId, fuelSupplierId: supplierId, worksiteId,
      product: "PETROLEO DIESEL", productId, liters: 120, baseAmount: 1000, totalAmount: 1190, createdBy: userId,
    })
  })

  describe("registro en terreno", () => {
    it("con view_personal trae los nombres y las fotos; la revisión de la plataforma y el pedido abierto", async () => {
      const detail = await loadTerrenoDetail(sessionFor(["combustibles:view_personal", "combustibles:tae_view"]), taeId)
      expect(detail).not.toBeNull()
      expect(detail).toMatchObject({ origen: "terreno", worksiteName: "Faena Ficha", driverName: "Marcelo Conductor", supervisorName: "Rodrigo Supervisor", evidenceCount: 2, registeredByName: "Ana Revisora" })
      expect(detail!.evidence.map((item) => item.kind).sort()).toEqual(["liter_meter", "odometer"])
      expect(detail!.review).toMatchObject({ equipmentLoadId, reviewStatus: "flagged", flagReasons: ["meter_regression"] })
      expect(detail!.openRequest).toMatchObject({ id: markId, note: "Revisar los litros", markedByName: "Luis Auditor" })
      expect(detail!.equipmentLabel).toContain("CA-14")
    })

    it("sin view_personal los nombres y las fotos ni salen de la consulta (el conteo sí)", async () => {
      const detail = await loadTerrenoDetail(sessionFor(["combustibles:tae_view"]), taeId)
      expect(detail!.driverName).toBeNull()
      expect(detail!.supervisorName).toBeNull()
      expect(detail!.evidence).toEqual([])
      expect(detail!.evidenceCount).toBe(2)
      expect(JSON.stringify(detail)).not.toMatch(/Marcelo|Rodrigo|tablero\.jpg/)
    })

    it("una carga fuera del alcance de faenas, o que no existe, es nula (404), igual en los dos casos", async () => {
      expect(await loadTerrenoDetail(sessionFor([], { worksiteIds: [otherWorksiteId] }), taeId)).toBeNull()
      expect(await loadTerrenoDetail(sessionFor([]), "no-existe")).toBeNull()
      expect(await loadTerrenoDetail(sessionFor([], { global: true, worksiteIds: [] }), taeId)).not.toBeNull()
    })

    it("la línea de tiempo cuenta el alta, el pedido y el estado sin repetir el estado inicial; la auditoría sólo con view_audit", async () => {
      const without = await loadTerrenoDetail(sessionFor(["combustibles:tae_view"]), taeId)
      const texts = without!.timeline.map((event) => event.text)
      expect(texts).toContain("Ana Revisora registró la carga desde la app")
      expect(texts).toContain("Ana Revisora dejó la carga con observación")
      expect(texts).toContain("Luis Auditor pidió que la revisen")
      expect(texts).toContain("La plataforma la dejó por decidir: lectura de medidor menor a la anterior")
      expect(texts.filter((text) => /por validar/i.test(text))).toEqual([])
      expect(texts.some((text) => text.includes("corrigió la lectura"))).toBe(false)

      const withAudit = await loadTerrenoDetail(sessionFor(["combustibles:tae_view", "combustibles:view_audit"]), taeId)
      expect(withAudit!.timeline.map((event) => event.text)).toContain("Ana Revisora corrigió la lectura del medidor de 1.000 a 182.310")
    })
  })

  describe("fila de la planilla", () => {
    it("trae el archivo, los campos de la planilla y oculta personas y montos sin permiso", async () => {
      const detail = await loadPlanillaDetail(sessionFor([]), recordId)
      expect(detail).toMatchObject({ origen: "planilla", canViewPersonal: false, operador: null, supervisor: null, costs: null })
      expect(detail!.batch).toMatchObject({ fileName: "consolidado.xlsx", importedByName: "Ana Revisora", totalFilas: 10, filasInvalidas: 2 })
      expect(detail!.record).toMatchObject({ fecha: "2026-10-10", horaCarga: "08:30", liters: 50, horometro: 5000, medidoPor: "km", tipoRendimiento: "km_lt" })
      const raw = JSON.stringify(detail!.rawRow)
      expect(raw).not.toMatch(/Pedro|55000|OPERADOR|MONTO/)
      expect(raw).toContain("PATENTE")
    })

    it("con view_personal y view_costs trae los nombres y los montos", async () => {
      const detail = await loadPlanillaDetail(sessionFor(["combustibles:view_personal", "combustibles:view_costs"]), recordId)
      expect(detail).toMatchObject({ canViewPersonal: true, operador: "Pedro Operador", supervisor: "Marta Jefa", costs: { precioLitro: 1100, monto: 55000 } })
      expect(JSON.stringify(detail!.rawRow)).toContain("Pedro Operador")
    })

    it("una fila sin faena vinculada sólo la ve un rol global; una de otra faena no la ve quien no la tiene", async () => {
      expect(await loadPlanillaDetail(sessionFor([]), recordNoWorksiteId)).toBeNull()
      expect(await loadPlanillaDetail(sessionFor([], { global: true, worksiteIds: [] }), recordNoWorksiteId)).not.toBeNull()
      expect(await loadPlanillaDetail(sessionFor([], { worksiteIds: [otherWorksiteId] }), recordId)).toBeNull()
    })
  })

  describe("factura", () => {
    it("sin view_costs queda en lectura y la línea de tiempo no menciona montos", async () => {
      const detail = await loadFacturaDetail(sessionFor(["combustibles:view_audit"]), invoiceId)
      expect(detail).toMatchObject({ origen: "factura", canViewCosts: false, supplierName: expect.stringContaining("Copec") })
      expect(detail!.load).toMatchObject({ baseAmount: 0, iecTotal: 0, ivaAmount: 0, totalAmount: 0, liters: 120 })
      const modified = detail!.timeline.find((event) => event.text.includes("modificó"))
      expect(modified?.text).toBe("Ana Revisora modificó los litros (de 100 a 120)")
    })

    it("con view_costs y view_audit la línea de tiempo suma los montos", async () => {
      const detail = await loadFacturaDetail(sessionFor(["combustibles:view_costs", "combustibles:view_audit"]), invoiceId)
      expect(detail!.canViewCosts).toBe(true)
      expect(detail!.load.totalAmount).toBe(1190)
      expect(detail!.timeline.find((event) => event.text.includes("modificó"))?.text).toBe("Ana Revisora modificó los litros (de 100 a 120) y los montos")
    })

    it("fuera de la faena, 404", async () => {
      expect(await loadFacturaDetail(sessionFor([], { worksiteIds: [otherWorksiteId] }), invoiceId)).toBeNull()
    })
  })

  describe("historial campo a campo", () => {
    it("trae la auditoría de la carga, sin montos para quien no los ve", async () => {
      const hidden = await loadHistory(sessionFor(["combustibles:view_audit"]), "factura", invoiceId)
      expect(hidden!.audit).toHaveLength(1)
      expect(hidden!.audit[0]!.newState).not.toContain("totalAmount")
      expect(hidden!.audit[0]!.newState).toContain("liters")
      const visible = await loadHistory(sessionFor(["combustibles:view_audit", "combustibles:view_costs"]), "factura", invoiceId)
      expect(visible!.audit[0]!.newState).toContain("totalAmount")
    })

    it("incluye la auditoría de la fila proyectada y respeta el alcance", async () => {
      const history = await loadHistory(sessionFor(["combustibles:view_audit", "combustibles:tae_view"]), "terreno", taeId)
      expect(history!.audit.map((row) => row.entityType)).toContain("fuel_tae_submission")
      expect(await loadHistory(sessionFor(["combustibles:view_audit"], { worksiteIds: [otherWorksiteId] }), "terreno", taeId)).toBeNull()
    })
  })
})
