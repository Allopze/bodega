/**
 * Pagos › Estados de cuenta (L7, rediseño de Combustible).
 *
 * La vista previa de «Crear estado de cuenta» es el paso de confirmación: lo que
 * muestra tiene que ser exactamente lo que la acción guarda después. Esta prueba
 * corre las dos contra el mismo Postgres (PGlite) y compara cada cifra, y fija
 * además las reglas que las rodean: un mes sin cargas, lo que no entra (borradores,
 * anuladas, ya asignadas), el estado de cuenta que ya existe con lo pagado, el
 * alcance global y el resumen de lo que falta pagar que lee el Panel.
 *
 * También ejecuta contra Postgres las consultas de «Pagos › Facturas»
 * (`loadInvoicesData`): la lista con todos los estados, las cifras que sólo
 * cuentan consumo real, la búsqueda y el alcance por faena.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { previewMonthlyStatement } = await import("@/lib/combustibles/statements-preview")
const { getPayablesSummary } = await import("@/lib/combustibles/payables-summary")
const { calculateStatementTotals } = await import("@/lib/combustibles/calculations")
const { resolveFuelPeriod, currentMonthPeriod } = await import("@/lib/combustibles/period")
const { createMonthlyStatementAction, addPaymentAction } = await import("@/app/(app)/combustibles/actions-module/statements")
const { loadInvoicesData } = await import("@/app/(app)/combustibles/pagos/invoice-data")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const MONTH = "2020-02"
const SUPPLIER_A = "sup-a"
const SUPPLIER_B = "sup-b"

function session(overrides: { isGlobal?: boolean; permissions?: string[]; worksiteIds?: string[] } = {}): Session {
  return {
    user: {
      id: "actor", name: "Finanzas", email: "finanzas@example.com", roles: ["administrador"],
      permissions: overrides.permissions ?? ["combustibles:view", "combustibles:view_costs", "combustibles:manage_statements"],
      worksiteIds: overrides.worksiteIds ?? [], primaryWorksiteId: null, avatarColor: null, isActive: true,
      isGlobal: overrides.isGlobal ?? true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

let loadSeq = 0
function load(overrides: Partial<typeof schema.fuelLoads.$inferInsert> & { id?: string } = {}) {
  loadSeq += 1
  return {
    id: overrides.id ?? `load-${loadSeq}`, loadDate: `${MONTH}-10`, month: MONTH, serviceType: "TCT",
    vehicleId: "veh-1", fuelSupplierId: SUPPLIER_A, worksiteId: "ws-a", product: "PETROLEO DIESEL", productId: "prod-1",
    liters: 100, baseAmount: 100_000, iecTotal: 10_000, ivaAmount: 19_000, totalAmount: 129_000,
    status: "registered", createdBy: "actor",
    ...overrides,
  } satisfies typeof schema.fuelLoads.$inferInsert
}

function createForm(extra: Record<string, string> = {}, supplierId = SUPPLIER_A, month = MONTH) {
  const form = new FormData()
  form.set("month", month)
  form.set("fuelSupplierId", supplierId)
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  return form
}

describe("estados de cuenta: vista previa y creación", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session())
    await inMemoryDb.delete(schema.fuelPayments)
    await inMemoryDb.delete(schema.fuelLoads)
    await inMemoryDb.delete(schema.fuelMonthlyStatements)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.fuelEquipmentTypes)
    await inMemoryDb.delete(schema.fuelSuppliers)
    await inMemoryDb.delete(schema.fuelProducts)
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values({ id: "ws-a", name: "Faena A", code: "FN-A" })
    await inMemoryDb.insert(schema.users).values({ id: "actor", name: "Finanzas", email: "finanzas@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelSuppliers).values([{ id: SUPPLIER_A, name: "Copec" }, { id: SUPPLIER_B, name: "Aramco" }])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-1", code: "DIESEL", name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-1", slug: "camioneta", name: "Camioneta" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: "veh-1", plate: "AAAA11", type: "camioneta", equipmentTypeId: "fet-1", worksiteId: "ws-a", isActive: true },
      { id: "veh-2", plate: "BBBB22", type: "camioneta", equipmentTypeId: "fet-1", worksiteId: "ws-a", isActive: true },
    ])
  })

  it("la vista previa coincide, cifra por cifra, con el estado de cuenta que crea la acción", async () => {
    // Litros con cuatro decimales: sumados en SQL darían 35,0012, y el estado de
    // cuenta guarda el total redondeado. La vista previa tiene que decir lo mismo.
    await inMemoryDb.insert(schema.fuelLoads).values([
      load({ id: "l-1", loadDate: "2020-02-03", liters: 10.0004, baseAmount: 1_000.4, iecTotal: 100.25, ivaAmount: 190.08, totalAmount: 1_290.73 }),
      load({ id: "l-2", loadDate: "2020-02-11", vehicleId: "veh-2", liters: 20.0004, baseAmount: 2_000.4, iecTotal: 200.25, ivaAmount: 380.08, totalAmount: 2_580.73, status: "reconciled" }),
      load({ id: "l-3", loadDate: "2020-02-27", liters: 5.0004, baseAmount: 500.4, iecTotal: 50.25, ivaAmount: 95.08, totalAmount: 645.73 }),
      // Lo que NO entra: un borrador, una anulada y una carga de otro proveedor.
      load({ id: "l-draft", status: "draft", liters: 999 }),
      load({ id: "l-cancelled", status: "cancelled", liters: 777 }),
      load({ id: "l-other-supplier", fuelSupplierId: SUPPLIER_B }),
    ])

    const preview = await previewMonthlyStatement(session(), { month: MONTH, fuelSupplierId: SUPPLIER_A })

    expect(preview).toMatchObject({
      month: MONTH, supplierName: "Copec", loads: 3, equipmentCount: 2,
      firstLoadDate: "2020-02-03", lastLoadDate: "2020-02-27", existing: null, monthInProgress: false,
      excluded: { draft: 1, cancelled: 1, alreadyInStatement: 0 },
    })
    expect(preview.totals).toEqual(calculateStatementTotals([
      { liters: 10.0004, baseAmount: 1_000.4, iecTotal: 100.25, ivaAmount: 190.08, totalAmount: 1_290.73 },
      { liters: 20.0004, baseAmount: 2_000.4, iecTotal: 200.25, ivaAmount: 380.08, totalAmount: 2_580.73 },
      { liters: 5.0004, baseAmount: 500.4, iecTotal: 50.25, ivaAmount: 95.08, totalAmount: 645.73 },
    ]))
    expect(preview.totals.totalLiters).toBe(35)

    // La persona confirma lo que vio: la acción recibe sus cargas y su total.
    const result = await createMonthlyStatementAction(
      { ok: false },
      createForm({ expectedLoadCount: String(preview.loads), expectedTotalAmount: String(preview.totals.totalAmount), dueDate: "2020-03-10" }),
    )
    expect(result.ok).toBe(true)
    const statementId = String(result.data?.id)

    const stored = await inMemoryDb.query.fuelMonthlyStatements.findFirst({ where: eq(schema.fuelMonthlyStatements.id, statementId) })
    expect(stored).toMatchObject({
      month: MONTH, fuelSupplierId: SUPPLIER_A, dueDate: "2020-03-10", paidAmount: 0, status: "open",
      totalLiters: preview.totals.totalLiters,
      totalBaseAmount: preview.totals.totalBaseAmount,
      totalIec: preview.totals.totalIec,
      totalIva: preview.totals.totalIva,
      totalAmount: preview.totals.totalAmount,
    })

    // Y las cargas que la vista previa decía que entraban son exactamente las asignadas.
    const assigned = await inMemoryDb.query.fuelLoads.findMany({ where: eq(schema.fuelLoads.statementId, statementId) })
    expect(assigned.map((row) => row.id).sort()).toEqual(["l-1", "l-2", "l-3"])
    const untouched = await inMemoryDb.query.fuelLoads.findMany({ where: eq(schema.fuelLoads.status, "draft") })
    expect(untouched[0]?.statementId).toBeNull()
  })

  it("un mes sin cargas se previsualiza en cero y la acción se niega a crearlo", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(load({ id: "l-draft", status: "draft" }))

    const preview = await previewMonthlyStatement(session(), { month: MONTH, fuelSupplierId: SUPPLIER_A })

    expect(preview).toMatchObject({ loads: 0, firstLoadDate: null, lastLoadDate: null, equipmentCount: 0, excluded: { draft: 1 } })
    expect(preview.totals.totalAmount).toBe(0)

    const result = await createMonthlyStatementAction({ ok: false }, createForm())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no hay cargas sin estado de cuenta/i)
    expect(await inMemoryDb.query.fuelMonthlyStatements.findMany()).toHaveLength(0)
  })

  it("si el estado de cuenta ya existe, la vista previa dice cuánto se pagó y la acción no crea otro", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values([load({ id: "l-1" }), load({ id: "l-2", vehicleId: "veh-2" })])
    const first = await createMonthlyStatementAction({ ok: false }, createForm())
    expect(first.ok).toBe(true)
    const statementId = String(first.data?.id)

    const payment = new FormData()
    payment.set("statementId", statementId)
    payment.set("paymentDate", "2020-03-05")
    payment.set("amount", "100000")
    expect((await addPaymentAction({ ok: false }, payment)).ok).toBe(true)

    const preview = await previewMonthlyStatement(session(), { month: MONTH, fuelSupplierId: SUPPLIER_A })

    expect(preview.existing).toMatchObject({ id: statementId, status: "partial", totalAmount: 258_000, paidAmount: 100_000, pendingAmount: 158_000 })
    expect(preview.loads).toBe(0)
    expect(preview.excluded.alreadyInStatement).toBe(2)

    const again = await createMonthlyStatementAction({ ok: false }, createForm())
    expect(again.ok).toBe(false)
    expect(again.message).toMatch(/ya existe un estado de cuenta/i)
    expect(await inMemoryDb.query.fuelMonthlyStatements.findMany()).toHaveLength(1)
  })

  it("si cambian las cargas entre la vista previa y el clic, no guarda un total que nadie confirmó", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(load({ id: "l-1" }))
    const preview = await previewMonthlyStatement(session(), { month: MONTH, fuelSupplierId: SUPPLIER_A })

    // Mientras la persona revisaba, se registró otra carga del mismo mes.
    await inMemoryDb.insert(schema.fuelLoads).values(load({ id: "l-2", vehicleId: "veh-2" }))

    const result = await createMonthlyStatementAction(
      { ok: false },
      createForm({ expectedLoadCount: String(preview.loads), expectedTotalAmount: String(preview.totals.totalAmount) }),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cambiaron/i)
    expect(await inMemoryDb.query.fuelMonthlyStatements.findMany()).toHaveLength(0)
    const refreshed = await previewMonthlyStatement(session(), { month: MONTH, fuelSupplierId: SUPPLIER_A })
    expect(refreshed.loads).toBe(2)
  })

  it("el mes en curso se avisa como «en curso»: lo que se registre después quedaría fuera", async () => {
    const currentMonth = todayInChile().slice(0, 7)
    await inMemoryDb.insert(schema.fuelLoads).values(load({ id: "l-now", month: currentMonth, loadDate: `${currentMonth}-01` }))

    const preview = await previewMonthlyStatement(session(), { month: currentMonth, fuelSupplierId: SUPPLIER_A })

    expect(preview).toMatchObject({ loads: 1, monthInProgress: true })
  })

  it("alcance global: ni la vista previa ni la acción sirven a un rol acotado ni a quien no ve costos", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(load({ id: "l-1" }))
    const scoped = session({ isGlobal: false, worksiteIds: ["ws-a"] })
    const noCosts = session({ permissions: ["combustibles:view", "combustibles:manage_statements"] })

    await expect(previewMonthlyStatement(scoped, { month: MONTH, fuelSupplierId: SUPPLIER_A })).rejects.toThrow(/acceso global/i)
    await expect(previewMonthlyStatement(noCosts, { month: MONTH, fuelSupplierId: SUPPLIER_A })).rejects.toThrow(/costos/i)
    await expect(previewMonthlyStatement(session(), { month: "febrero", fuelSupplierId: SUPPLIER_A })).rejects.toThrow(/mes inválido/i)

    for (const actor of [scoped, noCosts, session({ permissions: ["combustibles:view", "combustibles:view_costs"] })]) {
      mockAuth.mockResolvedValueOnce(actor)
      const result = await createMonthlyStatementAction({ ok: false }, createForm())
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/permisos/i) })
    }
    expect(await inMemoryDb.query.fuelMonthlyStatements.findMany()).toHaveLength(0)
    expect((await inMemoryDb.query.fuelLoads.findFirst({ where: eq(schema.fuelLoads.id, "l-1") }))?.statementId).toBeNull()
  })
})

describe("getPayablesSummary: lo que falta pagar", () => {
  const period = () => resolveFuelPeriod({ searchParams: { periodo: "2020-03" }, cookieValue: null, fallback: currentMonthPeriod() })

  function statement(id: string, month: string, supplierId: string, dueDate: string | null, total: number, paid: number, status: string) {
    return {
      id, month, fuelSupplierId: supplierId, totalLiters: 10, totalBaseAmount: total, totalIec: 0, totalIva: 0,
      totalAmount: total, paidAmount: paid, dueDate, status, createdBy: "actor",
    } satisfies typeof schema.fuelMonthlyStatements.$inferInsert
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    await inMemoryDb.delete(schema.fuelPayments)
    await inMemoryDb.delete(schema.fuelLoads)
    await inMemoryDb.delete(schema.fuelMonthlyStatements)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.fuelEquipmentTypes)
    await inMemoryDb.delete(schema.fuelSuppliers)
    await inMemoryDb.delete(schema.fuelProducts)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values({ id: "ws-a", name: "Faena A", code: "FN-A" })
    await inMemoryDb.insert(schema.users).values({ id: "actor", name: "Finanzas", email: "finanzas@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelSuppliers).values([{ id: SUPPLIER_A, name: "Copec" }, { id: SUPPLIER_B, name: "Aramco" }])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-1", code: "DIESEL", name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-1", slug: "camioneta", name: "Camioneta" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: "veh-1", plate: "AAAA11", type: "camioneta", equipmentTypeId: "fet-1", worksiteId: "ws-a", isActive: true })
  })

  it("suma lo que se debe, separa lo vencido y ordena por vencimiento; ignora lo pagado y lo posterior al período", async () => {
    const today = todayInChile()
    await inMemoryDb.insert(schema.fuelMonthlyStatements).values([
      statement("st-late", "2020-02", SUPPLIER_A, addDaysToPlainDate(today, -10), 1_000_000, 400_000, "partial"),
      statement("st-soon", "2020-02", SUPPLIER_B, addDaysToPlainDate(today, 6), 500_000, 0, "open"),
      statement("st-nodate", "2020-01", SUPPLIER_B, null, 200_000, 50_000, "partial"),
      statement("st-paid", "2020-01", SUPPLIER_A, addDaysToPlainDate(today, -40), 300_000, 300_000, "paid"),
      // De un mes posterior al período (marzo de 2020): no es deuda «hasta» marzo.
      statement("st-later", "2020-04", SUPPLIER_A, addDaysToPlainDate(today, -1), 900_000, 0, "open"),
    ])

    const summary = await getPayablesSummary(session(), period())

    expect(summary.dueStatements.map((row) => row.statementId)).toEqual(["st-late", "st-soon", "st-nodate"])
    expect(summary.dueStatements.map((row) => row.overdue)).toEqual([true, false, false])
    expect(summary.dueStatements[0]).toMatchObject({ supplierName: "Copec", month: "2020-02", pendingAmount: 600_000 })
    expect(summary.pendingAmount).toBe(600_000 + 500_000 + 150_000)
    expect(summary.overdueAmount).toBe(600_000)
  })

  it("lista los meses del período con cargas facturadas y sin estado de cuenta, sin contar borradores ni los que ya tienen uno", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values([
      load({ id: "a-1", month: "2020-03", loadDate: "2020-03-05", fuelSupplierId: SUPPLIER_A, totalAmount: 100_000 }),
      load({ id: "a-2", month: "2020-03", loadDate: "2020-03-09", fuelSupplierId: SUPPLIER_A, totalAmount: 50_000, status: "reconciled" }),
      load({ id: "a-draft", month: "2020-03", loadDate: "2020-03-09", fuelSupplierId: SUPPLIER_A, totalAmount: 9_999_999, status: "draft" }),
      // Aramco ya tiene su estado de cuenta de marzo: lo suelto sería una carga tardía, no «sin estado de cuenta».
      load({ id: "b-1", month: "2020-03", loadDate: "2020-03-12", fuelSupplierId: SUPPLIER_B, totalAmount: 70_000 }),
      // Otro mes, fuera del período.
      load({ id: "a-feb", month: "2020-02", loadDate: "2020-02-12", fuelSupplierId: SUPPLIER_A, totalAmount: 11_000 }),
    ])
    await inMemoryDb.insert(schema.fuelMonthlyStatements).values(statement("st-b-mar", "2020-03", SUPPLIER_B, null, 70_000, 70_000, "paid"))

    const summary = await getPayablesSummary(session(), period())

    expect(summary.monthsWithoutStatement).toEqual([
      { supplierId: SUPPLIER_A, supplierName: "Copec", month: "2020-03", loads: 2, totalAmount: 150_000, monthClosed: true },
    ])
  })

  it("exige alcance global y costos: un rol acotado no ve deudas de proveedores", async () => {
    await expect(getPayablesSummary(session({ isGlobal: false, worksiteIds: ["ws-a"] }), period())).rejects.toThrow(/acceso global/i)
    await expect(getPayablesSummary(session({ permissions: ["combustibles:view"] }), period())).rejects.toThrow(/costos/i)
  })
})

describe("Pagos › Facturas: lista, cifras y búsqueda (loadInvoicesData)", () => {
  const FEB = { month: MONTH }

  beforeEach(async () => {
    vi.clearAllMocks()
    await inMemoryDb.delete(schema.fuelLoads)
    await inMemoryDb.delete(schema.fuelVehicles)
    await inMemoryDb.delete(schema.fuelEquipmentTypes)
    await inMemoryDb.delete(schema.fuelSuppliers)
    await inMemoryDb.delete(schema.fuelProducts)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    await inMemoryDb.insert(schema.worksites).values([{ id: "ws-a", name: "Faena A", code: "FN-A" }, { id: "ws-b", name: "Faena B", code: "FN-B" }])
    await inMemoryDb.insert(schema.users).values({ id: "actor", name: "Finanzas", email: "finanzas@example.com", hashedPassword: "x" })
    await inMemoryDb.insert(schema.fuelSuppliers).values([{ id: SUPPLIER_A, name: "Copec" }, { id: SUPPLIER_B, name: "Aramco" }])
    await inMemoryDb.insert(schema.fuelProducts).values({ id: "prod-1", code: "DIESEL", name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-1", slug: "camioneta", name: "Camioneta" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: "veh-1", plate: "AB-CD-12", code: "KA-63", type: "camioneta", equipmentTypeId: "fet-1", worksiteId: "ws-a", isActive: true },
      { id: "veh-2", plate: "ZZZZ99", type: "camioneta", equipmentTypeId: "fet-1", worksiteId: "ws-b", isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelLoads).values([
      load({ id: "i-1", loadDate: "2020-02-10", receiptNumber: "F-881204", worksiteId: "ws-a", vehicleId: "veh-1", fuelSupplierId: SUPPLIER_A, baseAmount: 70_000, iecTotal: 10_000, ivaAmount: 13_300, totalAmount: 93_300, liters: 100 }),
      load({ id: "i-2", loadDate: "2020-02-20", receiptNumber: "F-55120", worksiteId: "ws-b", vehicleId: "veh-2", fuelSupplierId: SUPPLIER_B, status: "reconciled", baseAmount: 140_000, iecTotal: 20_000, ivaAmount: 26_600, totalAmount: 186_600, liters: 200 }),
      load({ id: "i-draft", loadDate: "2020-02-05", worksiteId: "ws-a", vehicleId: "veh-1", status: "draft", totalAmount: 999_999 }),
      load({ id: "i-cancelled", loadDate: "2020-02-06", worksiteId: "ws-a", vehicleId: "veh-1", status: "cancelled", totalAmount: 888_888 }),
    ])
  })

  it("la lista trae todos los estados, de la más reciente a la más antigua, y las cifras sólo cuentan consumo real", async () => {
    const data = await loadInvoicesData(session(), FEB, 1)

    expect(data.degraded).toEqual([])
    expect(data.rows.map((row) => row.id)).toEqual(["i-2", "i-1", "i-cancelled", "i-draft"])
    expect(data.pagination).toMatchObject({ totalItems: 4, page: 1 })
    expect(data.rows.find((row) => row.id === "i-1")).toMatchObject({
      vehicle: { code: "KA-63", plate: "AB-CD-12" }, supplierName: "Copec", worksiteName: "Faena A", receiptNumber: "F-881204", iecTotal: 10_000,
    })
    // 93.300 + 186.600: ni el borrador (999.999) ni la anulada (888.888) suman.
    expect(data.summary).toEqual({ loads: 2, liters: 300, base: 210_000, iec: 30_000, iva: 39_900, total: 279_900 })
  })

  it("los gráficos usan las mismas cargas que las cifras y rotulan el equipo con su código", async () => {
    const { charts } = await loadInvoicesData(session(), FEB, 1)

    expect(charts.byMonth).toMatchObject([{ group: MONTH, totalAmount: 279_900 }])
    expect(charts.byWorksite.map((row) => row.group)).toEqual(["Faena B", "Faena A"])
    expect(charts.byEquipment.map((row) => row.group)).toEqual(["ZZZZ99", "KA-63 · AB-CD-12"])
    expect(charts.byProduct).toMatchObject([{ group: "PETROLEO DIESEL", totalAmount: 279_900 }])
  })

  it("filtrar por un estado manda sobre las cifras: acompañan a lo que se ve", async () => {
    const data = await loadInvoicesData(session(), { ...FEB, status: "draft" }, 1)

    expect(data.rows.map((row) => row.id)).toEqual(["i-draft"])
    expect(data.summary).toMatchObject({ loads: 1, total: 999_999 })
  })

  it("busca por N.º de factura, patente con o sin guiones, código del equipo y proveedor; escapa los comodines", async () => {
    const ids = async (q: string) => (await loadInvoicesData(session(), { ...FEB, q }, 1)).rows.map((row) => row.id).sort()

    expect(await ids("f-881204")).toEqual(["i-1"])
    expect(await ids("abcd12")).toEqual(["i-1", "i-cancelled", "i-draft"])
    expect(await ids("AB-CD-12")).toEqual(["i-1", "i-cancelled", "i-draft"])
    expect(await ids("ka-63")).toEqual(["i-1", "i-cancelled", "i-draft"])
    expect(await ids("aramco")).toEqual(["i-2"])
    // `%` es un carácter más, no «todo».
    expect(await ids("%")).toEqual([])
    expect(await ids("no existe")).toEqual([])
  })

  it("un rol acotado sólo ve lo de sus faenas, también en las cifras y en las opciones de los filtros", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: ["ws-a"], permissions: ["combustibles:view", "combustibles:view_costs"] })

    const data = await loadInvoicesData(scoped, FEB, 1)

    expect(data.rows.map((row) => row.id).sort()).toEqual(["i-1", "i-cancelled", "i-draft"])
    expect(data.summary).toMatchObject({ loads: 1, total: 93_300 })
    expect(data.options.worksites).toEqual([{ id: "ws-a", name: "Faena A" }])
    expect(data.options.vehicles.map((vehicle) => vehicle.id)).toEqual(["veh-1"])
    // Pedir la faena ajena a mano no la abre: el alcance se intersecta, no se reemplaza.
    const other = await loadInvoicesData(scoped, { ...FEB, worksiteId: "ws-b" }, 1)
    expect(other.rows).toEqual([])
  })

  it("una página más allá del final se acota a la última en vez de mostrar una lista vacía", async () => {
    const data = await loadInvoicesData(session(), FEB, 99)

    expect(data.pagination.page).toBe(1)
    expect(data.rows).toHaveLength(4)
  })
})
