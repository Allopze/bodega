/**
 * CHART-034 · consultas de `/compras/dte`: OC por mes y estado de conciliación,
 * con el monto por facturar, y cobertura de DTE por período.
 *
 * Contra Postgres de verdad porque lo que importa vive en el SQL: el mes de
 * emisión en hora de Chile (una OC emitida el 30-sep a las 23:30 no es de octubre),
 * las notas de crédito que restan, las facturas anuladas que no cuentan, el tope
 * en cero por OC y el alcance por faena.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getOrderReconciliationByMonth, getDteCoverageByPeriod } = await import("../services/purchasing-module/reconciliation-overview")

const TODAY = "2026-11-03"
const COD_EMP = "433"
const worksiteA = nanoid()
const worksiteB = nanoid()
const userId = nanoid()
const supplierId = nanoid()
let invoiceOfA1 = ""

const session = (scope: { isGlobal: boolean; worksiteIds: string[] }): Session => ({
  user: { id: userId, name: "Compras", email: "c@example.com", roles: ["compras"], permissions: ["purchasing:view"], primaryWorksiteId: null, avatarColor: null, isActive: true, ...scope },
  expires: "2099-01-01T00:00:00.000Z",
} as unknown as Session)

const everyone = session({ isGlobal: true, worksiteIds: [] })
const onlyA = session({ isGlobal: false, worksiteIds: [worksiteA] })
const onlyB = session({ isGlobal: false, worksiteIds: [worksiteB] })

let seq = 0
async function order(input: {
  worksiteId: string; status?: string; total: number; issuedAt: string | null; reconciliation: string; deletedAt?: string
}) {
  const id = nanoid()
  await testDb.insert(schema.purchaseOrders).values({
    id, code: `OC-T-${++seq}-${nanoid(4)}`, worksiteId: input.worksiteId, supplierId, createdBy: userId,
    status: input.status ?? "received", issuedAt: input.issuedAt, totalAmount: input.total,
    invoiceReconciliationStatus: input.reconciliation, deletedAt: input.deletedAt ?? null,
  })
  return id
}

async function invoice(purchaseOrderId: string, amount: number, extra: { kind?: "invoice" | "credit_note"; voided?: boolean } = {}) {
  const id = nanoid()
  await testDb.insert(schema.purchaseOrderInvoices).values({
    id, purchaseOrderId, invoiceNumber: `F-${++seq}`, documentKind: extra.kind ?? "invoice", amount,
    fileName: "f.pdf", filePath: "storage/f.pdf", uploadedBy: userId,
    ...(extra.voided ? { voidedAt: "2026-10-30T12:00:00.000Z", voidedBy: userId, voidReason: "Factura cargada en la OC equivocada" } : {}),
  })
  return id
}

let folio = 0
async function dte(input: { periodo: string; total: number; tipo?: string; invoiceId?: string; fuelLoadId?: string; estadoSii?: "anulado"; codEmp?: string }) {
  await testDb.insert(schema.dteDocuments).values({
    id: nanoid(), tipoDte: input.tipo ?? "33", folio: ++folio, rutEmisor: "76000000-0", razonSocialEmisor: "Proveedor",
    fechaEmision: `${input.periodo}-10`, montoTotal: input.total, codEmp: input.codEmp ?? COD_EMP, periodo: input.periodo,
    rawHash: `hash-${folio}-${nanoid()}`, purchaseOrderInvoiceId: input.invoiceId ?? null, fuelLoadId: input.fuelLoadId ?? null,
    estadoSii: input.estadoSii ?? null,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: userId, name: "Compras", email: `c-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
  await testDb.insert(schema.worksites).values([
    { id: worksiteA, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true },
    { id: worksiteB, name: "Pacífico", code: `PA-${nanoid().slice(0, 6)}`, isActive: true },
  ])
  await testDb.insert(schema.suppliers).values({ id: supplierId, name: "Proveedor", isActive: true })

  // Octubre, faena A: una conciliada (facturada por completo), una sin facturas.
  const a1 = await order({ worksiteId: worksiteA, total: 1_000_000, issuedAt: "2026-10-05T15:00:00.000Z", reconciliation: "matched" })
  invoiceOfA1 = await invoice(a1, 1_000_000)
  await order({ worksiteId: worksiteA, total: 500_000, issuedAt: "2026-10-20T15:00:00.000Z", reconciliation: "no_invoices" })
  // Emitida el 30-sep a las 23:30 de Chile (= 1-oct 02:30 UTC): es de septiembre. Facturada 300.000, con
  // una nota de crédito de 50.000 (resta) y una factura anulada de 999.999 (no cuenta): faltan 550.000.
  const a3 = await order({ worksiteId: worksiteA, total: 800_000, issuedAt: "2026-10-01T02:30:00.000Z", reconciliation: "partially_invoiced" })
  await invoice(a3, 300_000)
  await invoice(a3, -50_000, { kind: "credit_note" })
  await invoice(a3, 999_999, { voided: true })
  // Facturada de más: el saldo por facturar se topa en cero, no se vuelve negativo ni compensa a otras OC.
  const a7 = await order({ worksiteId: worksiteA, total: 100_000, issuedAt: "2026-10-12T15:00:00.000Z", reconciliation: "needs_review" })
  await invoice(a7, 150_000)
  // Fecha sin hora (filas antiguas): se toma tal cual, no se pasa por zona horaria.
  await order({ worksiteId: worksiteA, total: 40_000, issuedAt: "2026-11-01", reconciliation: "no_invoices" })
  // No cuentan: borrador, anulada, eliminada, sin fecha de emisión y fuera de la ventana de 12 meses.
  await order({ worksiteId: worksiteA, status: "draft", total: 1, issuedAt: "2026-10-05T15:00:00.000Z", reconciliation: "no_invoices" })
  await order({ worksiteId: worksiteA, status: "cancelled", total: 1, issuedAt: "2026-10-05T15:00:00.000Z", reconciliation: "no_invoices" })
  await order({ worksiteId: worksiteA, total: 1, issuedAt: "2026-10-05T15:00:00.000Z", reconciliation: "no_invoices", deletedAt: "2026-10-06T12:00:00.000Z" })
  await order({ worksiteId: worksiteA, total: 1, issuedAt: null, reconciliation: "no_invoices" })
  await order({ worksiteId: worksiteA, total: 777, issuedAt: "2025-01-10T15:00:00.000Z", reconciliation: "matched" })
  // Faena B: la A no debe ver nada de esto.
  await order({ worksiteId: worksiteB, total: 2_000_000, issuedAt: "2026-10-10T15:00:00.000Z", reconciliation: "no_invoices" })

  // DTE. El vínculo a combustible apunta a una carga que no se siembra: se apagan las FK sólo para insertarlo.
  await dte({ periodo: "2026-10", total: 1_000_000, invoiceId: invoiceOfA1 })
  await dte({ periodo: "2026-10", total: 119_000 })
  await dte({ periodo: "2026-10", total: -19_000, tipo: "61" })
  await pg.exec("set session_replication_role = replica")
  await dte({ periodo: "2026-09", total: 50_000, fuelLoadId: "carga-sin-sembrar" })
  await pg.exec("set session_replication_role = origin")
  await dte({ periodo: "2026-10", total: 5_555, estadoSii: "anulado" })
  await dte({ periodo: "2026-10", total: 4_444, codEmp: "999" })
  await dte({ periodo: "2025-01", total: 3_333 })
}, 120_000)

const byKey = (rows: Awaited<ReturnType<typeof getOrderReconciliationByMonth>>) =>
  Object.fromEntries(rows.map((row) => [`${row.month}:${row.status}`, row]))

describe("getOrderReconciliationByMonth", () => {
  it("agrupa por mes de emisión en hora de Chile y por estado, con el monto por facturar", async () => {
    const rows = byKey(await getOrderReconciliationByMonth(onlyA, { today: TODAY }))
    expect(rows["2026-10:matched"]).toMatchObject({ count: 1, toInvoice: 0, withBalance: 0 })
    expect(rows["2026-10:no_invoices"]).toMatchObject({ count: 1, toInvoice: 500_000, withBalance: 1 })
    // La del 30-sep 23:30 es de septiembre, no de octubre.
    expect(rows["2026-09:partially_invoiced"]).toMatchObject({ count: 1, toInvoice: 550_000, withBalance: 1 })
    expect(rows["2026-10:partially_invoiced"]).toBeUndefined()
  })

  it("las notas de crédito restan y las facturas anuladas no cuentan", async () => {
    const rows = byKey(await getOrderReconciliationByMonth(everyone, { today: TODAY }))
    // 800.000 − (300.000 − 50.000) = 550.000; la anulada de 999.999 no aparece.
    expect(rows["2026-09:partially_invoiced"]!.toInvoice).toBe(550_000)
  })

  it("una OC facturada de más no compensa a otra: el saldo se topa en cero por OC", async () => {
    const rows = byKey(await getOrderReconciliationByMonth(everyone, { today: TODAY }))
    expect(rows["2026-10:needs_review"]).toMatchObject({ count: 1, toInvoice: 0, withBalance: 0 })
  })

  it("una fecha sin hora se toma como viene", async () => {
    const rows = byKey(await getOrderReconciliationByMonth(everyone, { today: TODAY }))
    expect(rows["2026-11:no_invoices"]).toMatchObject({ count: 1, toInvoice: 40_000 })
  })

  it("no cuenta borradores, anuladas, eliminadas, sin fecha ni lo anterior a la ventana", async () => {
    const rows = await getOrderReconciliationByMonth(everyone, { today: TODAY })
    expect(rows.every((row) => row.month >= "2025-12")).toBe(true)
    const total = rows.reduce((sum, row) => sum + row.count, 0)
    // A: matched, no_invoices, parcial, needs_review, 1 de noviembre = 5; B: 1.
    expect(total).toBe(6)
  })

  it("un rol global ve las dos faenas", async () => {
    const rows = byKey(await getOrderReconciliationByMonth(everyone, { today: TODAY }))
    expect(rows["2026-10:no_invoices"]).toMatchObject({ count: 2, toInvoice: 500_000 + 2_000_000 })
  })

  it("quien ve la faena A no cuenta nada de la faena B", async () => {
    const rows = await getOrderReconciliationByMonth(onlyA, { today: TODAY })
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(5)
    expect(byKey(rows)["2026-10:no_invoices"]).toMatchObject({ count: 1, toInvoice: 500_000 })
  })

  it("quien sólo ve la faena B ve sólo la B", async () => {
    const rows = await getOrderReconciliationByMonth(onlyB, { today: TODAY })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ month: "2026-10", status: "no_invoices", count: 1, toInvoice: 2_000_000 })
  })

  it("una sesión sin faenas no ve nada", async () => {
    expect(await getOrderReconciliationByMonth(session({ isGlobal: false, worksiteIds: [] }), { today: TODAY })).toEqual([])
  })
})

describe("getDteCoverageByPeriod", () => {
  const find = (rows: NonNullable<Awaited<ReturnType<typeof getDteCoverageByPeriod>>>, periodo: string, link: string) =>
    rows.find((row) => row.periodo === periodo && row.link === link)

  it("reparte por período en vinculado a OC, a combustible y sin vincular", async () => {
    const rows = (await getDteCoverageByPeriod(everyone, COD_EMP, { today: TODAY }))!
    expect(find(rows, "2026-10", "oc")).toMatchObject({ count: 1, amount: 1_000_000 })
    expect(find(rows, "2026-09", "combustible")).toMatchObject({ count: 1, amount: 50_000 })
  })

  it("la nota de crédito resta del monto sin vincular y los anulados en el SII no cuentan", async () => {
    const rows = (await getDteCoverageByPeriod(everyone, COD_EMP, { today: TODAY }))!
    // 119.000 de la factura − 19.000 de la nota de crédito; el anulado de 5.555 queda fuera.
    expect(find(rows, "2026-10", "none")).toMatchObject({ count: 2, amount: 100_000 })
  })

  it("sólo cuenta la empresa de la sincronización y la ventana de 12 meses", async () => {
    const rows = (await getDteCoverageByPeriod(everyone, COD_EMP, { today: TODAY }))!
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(4)
    expect(rows.every((row) => row.periodo >= "2025-12")).toBe(true)
  })

  it("el DTE no tiene faena: quien está acotado a algunas faenas no recibe cifras de la empresa", async () => {
    expect(await getDteCoverageByPeriod(onlyA, COD_EMP, { today: TODAY })).toBeNull()
    expect(await getDteCoverageByPeriod(onlyB, COD_EMP, { today: TODAY })).toBeNull()
    expect(await getDteCoverageByPeriod(session({ isGlobal: false, worksiteIds: [] }), COD_EMP, { today: TODAY })).toBeNull()
  })
})
