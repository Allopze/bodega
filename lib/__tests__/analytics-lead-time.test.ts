import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// `can()` real arrastra next-auth y next/headers; sólo se necesita el chequeo de permisos de la sesión.
vi.mock("@/lib/auth/can", () => ({
  can: (session: Session | null, permission: string) => session?.user?.permissions?.includes(permission as never) ?? false,
}))

const { getSupplyLeadTime } = await import("@/lib/services/analytics-module/lead-time")
const { getItemLeadTime } = await import("@/lib/services/analytics-module/lead-time-item")
const { buildItemLeadTimeView } = await import("@/lib/services/analytics-module/lead-time-item-stages")
const { plainDateToDay } = await import("@/lib/services/analytics-module/lead-time-shape")

/**
 * CHART-029 · plazos del ciclo de abastecimiento. La parte numérica (medianas, P90, n, «datos
 * insuficientes») la prueba `lead-time-shape.test.ts`; acá se prueba lo que sólo Postgres decide:
 *
 *  - qué ítems entran (sólo cerrados, por su último movimiento, dentro del período);
 *  - de qué tablas sale cada hito y qué se descarta (recepciones y entregas anuladas, OC no emitidas);
 *  - el alcance de faenas: un usuario de la faena A no ve la B;
 *  - los filtros de tipo y de proveedor, que sólo acotan (nunca amplían el alcance) y miden la emisión y
 *    la llegada sobre las OC del proveedor elegido;
 *  - la lista de los ítems más lentos y la ficha de un ítem, que cuentan EXACTAMENTE los mismos hitos.
 *
 * Todas las fechas van a las 12:00 UTC, lejos de la medianoche chilena: el borde de día ya lo cubren
 * `analytics-chile-day` y `queue-age-pglite`.
 */

const WS_A = "ws-lt-a"
const WS_B = "ws-lt-b"
const USER = "u-lt"

const day = (iso: string) => `${iso}T12:00:00.000Z`
/** `2026-10-01` + n días. */
const plus = (base: string, days: number) => new Date(Date.parse(`${base}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

interface Chain {
  id: string
  ws: string
  submitted: string
  /** Días de cada tramo: aprobación, emisión de OC, llegada y (opcional) entrega. */
  approval: number
  purchase: number
  arrival: number
  delivery?: number
  status?: string
  voidedReceiptAt?: string
  voidedDeliveryAt?: string
  /** Proveedor de la OC (por defecto el único que había: `s-lt`). */
  supplier?: string
  requestType?: string
  /** Una segunda línea de OC del mismo ítem, de otro proveedor, que llega `arrival` días después de emitirse. */
  second?: { supplier: string; arrival: number }
}

let seq = 0

async function seedChain(chain: Chain) {
  seq += 1
  const approvedAt = plus(chain.submitted, chain.approval)
  const issuedAt = plus(approvedAt, chain.purchase)
  const receivedAt = plus(issuedAt, chain.arrival)
  const deliveredAt = chain.delivery === undefined ? null : plus(receivedAt, chain.delivery)
  const status = chain.status ?? (deliveredAt ? "delivered" : "received")

  await db.insert(schema.purchaseRequests).values({
    id: `r-${chain.id}`, code: `SOL-LT-${seq}`, worksiteId: chain.ws, requesterId: USER, requestType: chain.requestType ?? "epp", status: "closed", submittedAt: day(chain.submitted),
  })
  await db.insert(schema.purchaseRequestItems).values({ id: `i-${chain.id}`, requestId: `r-${chain.id}`, quantity: 1, status })
  await db.insert(schema.approvalDecisions).values([
    // La primera aprobación manda; una segunda decisión posterior no mueve el hito.
    { id: `ad-${chain.id}`, requestItemId: `i-${chain.id}`, requestId: `r-${chain.id}`, type: "approve", decidedBy: USER, decidedAt: day(approvedAt) },
    { id: `ad2-${chain.id}`, requestItemId: `i-${chain.id}`, requestId: `r-${chain.id}`, type: "approve", decidedBy: USER, decidedAt: day(plus(approvedAt, 5)) },
  ])
  await db.insert(schema.purchaseOrders).values({
    id: `oc-${chain.id}`, code: `OC-LT-${seq}`, worksiteId: chain.ws, supplierId: chain.supplier ?? "s-lt", createdBy: USER, status: "received",
    issuedAt: day(issuedAt), netAmount: 100, taxAmount: 19, totalAmount: 119,
  })
  await db.insert(schema.purchaseOrderItems).values({ id: `poi-${chain.id}`, purchaseOrderId: `oc-${chain.id}`, requestItemId: `i-${chain.id}`, quantity: 1, unitPrice: 100, subtotal: 100 })

  const receipt = (id: string, at: string, over: Partial<typeof schema.receipts.$inferInsert> = {}) => db.insert(schema.receipts).values({
    id, code: `REC-LT-${seq}-${id}`, purchaseOrderId: `oc-${chain.id}`, receivedBy: USER, receivedAt: day(at), worksiteId: chain.ws, ...over,
  })
  await receipt(`rc-${chain.id}`, receivedAt)
  await db.insert(schema.receiptItems).values({ id: `rci-${chain.id}`, receiptId: `rc-${chain.id}`, purchaseOrderItemId: `poi-${chain.id}`, quantityReceived: 1 })
  if (chain.voidedReceiptAt) {
    // Una recepción anulada MÁS TARDÍA no puede mover el cierre ni la llegada.
    await receipt(`rcv-${chain.id}`, chain.voidedReceiptAt, { status: "voided", voidedAt: day(chain.voidedReceiptAt), voidedBy: USER, voidReason: "Recepción equivocada, se anula" })
    await db.insert(schema.receiptItems).values({ id: `rciv-${chain.id}`, receiptId: `rcv-${chain.id}`, purchaseOrderItemId: `poi-${chain.id}`, quantityReceived: 1 })
  }

  if (chain.second) {
    // Línea de OC de otro proveedor, emitida el mismo día y recibida a su propio ritmo.
    await db.insert(schema.purchaseOrders).values({
      id: `oc2-${chain.id}`, code: `OC-LT-${seq}-B`, worksiteId: chain.ws, supplierId: chain.second.supplier, createdBy: USER, status: "received",
      issuedAt: day(issuedAt), netAmount: 100, taxAmount: 19, totalAmount: 119,
    })
    await db.insert(schema.purchaseOrderItems).values({ id: `poi2-${chain.id}`, purchaseOrderId: `oc2-${chain.id}`, requestItemId: `i-${chain.id}`, quantity: 1, unitPrice: 100, subtotal: 100 })
    await db.insert(schema.receipts).values({
      id: `rc2-${chain.id}`, code: `REC-LT-${seq}-B`, purchaseOrderId: `oc2-${chain.id}`, receivedBy: USER, receivedAt: day(plus(issuedAt, chain.second.arrival)), worksiteId: chain.ws,
    })
    await db.insert(schema.receiptItems).values({ id: `rci2-${chain.id}`, receiptId: `rc2-${chain.id}`, purchaseOrderItemId: `poi2-${chain.id}`, quantityReceived: 1 })
  }

  const delivery = (id: string, at: string, over: Partial<typeof schema.deliveries.$inferInsert> = {}) => db.insert(schema.deliveries).values({
    id, code: `ENT-LT-${seq}-${id}`, deliveredBy: USER, deliveredAt: day(at), destinationType: "faena", worksiteId: chain.ws, ...over,
  })
  if (deliveredAt) {
    await delivery(`d-${chain.id}`, deliveredAt)
    await db.insert(schema.deliveryItems).values({ id: `di-${chain.id}`, deliveryId: `d-${chain.id}`, requestItemId: `i-${chain.id}`, quantity: 1 })
  }
  if (chain.voidedDeliveryAt) {
    await delivery(`dv-${chain.id}`, chain.voidedDeliveryAt, { voidedAt: day(chain.voidedDeliveryAt), voidedBy: USER, voidReason: "Entrega equivocada, se anula" })
    await db.insert(schema.deliveryItems).values({ id: `div-${chain.id}`, deliveryId: `dv-${chain.id}`, requestItemId: `i-${chain.id}`, quantity: 1 })
  }
}

function session(overrides: { worksiteIds?: string[]; isGlobal?: boolean; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: USER, isActive: true, roles: [],
      isGlobal: overrides.isGlobal ?? true,
      worksiteIds: overrides.worksiteIds ?? [],
      permissions: overrides.permissions ?? ["analytics:view"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const OCTOBER = { fromDate: "2026-10-01", toDate: "2026-10-31" }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await pg.exec("SET TIME ZONE 'UTC'")
  await db.insert(schema.worksites).values([
    { id: WS_A, code: "LT-A", name: "Faena A" },
    { id: WS_B, code: "LT-B", name: "Faena B" },
  ])
  await db.insert(schema.users).values({ id: USER, name: "QA", email: "lt@test.local", hashedPassword: "hash" })
  await db.insert(schema.suppliers).values([{ id: "s-lt", name: "Proveedor LT" }, { id: "s-lt-2", name: "Proveedor LT 2" }])

  // Faena A, octubre: 6 ítems cerrados. Aprobación 1,1,2,2,3,3 (mediana 2); OC 2 días; llegada 4…9
  // (mediana 6,5); sólo 3 llevan entrega (1 día) → el tramo «Entrega» tiene n = 3 y no se publica.
  const approvals = [1, 1, 2, 2, 3, 3]
  const arrivals = [4, 5, 6, 7, 8, 9]
  for (const [i, approval] of approvals.entries()) {
    await seedChain({ id: `a${i}`, ws: WS_A, submitted: "2026-10-01", approval, purchase: 2, arrival: arrivals[i]!, ...(i < 3 ? { delivery: 1 } : {}) })
  }
  // Faena B, octubre: 5 ítems, todo de 1 día (y sin entrega).
  for (let i = 0; i < 5; i += 1) await seedChain({ id: `b${i}`, ws: WS_B, submitted: "2026-10-01", approval: 1, purchase: 1, arrival: 1 })

  // Distractores de la faena A que NO deben contar en octubre:
  await seedChain({ id: "a-abierto", ws: WS_A, submitted: "2026-10-01", approval: 1, purchase: 1, arrival: 1, status: "purchased" }) // aún no cerrado
  await seedChain({ id: "a-septiembre", ws: WS_A, submitted: "2026-09-10", approval: 1, purchase: 1, arrival: 2 }) // cerrado en septiembre
  await seedChain({ id: "a-noviembre", ws: WS_A, submitted: "2026-10-28", approval: 1, purchase: 1, arrival: 9 }) // cerrado en noviembre
  // La recepción anulada es posterior (30-oct): el ítem se cerró con la vigente (el 4-oct) y no se mueve.
  await seedChain({ id: "a-anulada", ws: WS_A, submitted: "2026-10-01", approval: 1, purchase: 1, arrival: 1, voidedReceiptAt: "2026-10-30", voidedDeliveryAt: "2026-10-31" })
  // Más ítems de septiembre en A: el período anterior (31-ago → 30-sep) llega a n = 5 con el de arriba + 4.
  for (let i = 0; i < 4; i += 1) await seedChain({ id: `a-prev${i}`, ws: WS_A, submitted: "2026-09-01", approval: 1, purchase: 1, arrival: 3 })

  // Diciembre: la ventana de los filtros de proveedor y tipo, aparte de octubre para no mover sus cifras.
  // Faena A: 5 ítems de EPP del proveedor 1 (cierran el 5-dic), 5 de repuestos del proveedor 2 (13-dic) y 1
  // dividido: línea del proveedor 1 que llega a los 3 días y línea del proveedor 2 a los 9 (cierra el 12-dic).
  for (let i = 0; i < 5; i += 1) await seedChain({ id: `dec-a-s1-${i}`, ws: WS_A, submitted: "2026-12-01", approval: 1, purchase: 1, arrival: 2 })
  for (let i = 0; i < 5; i += 1) await seedChain({ id: `dec-a-s2-${i}`, ws: WS_A, submitted: "2026-12-01", approval: 1, purchase: 1, arrival: 10, supplier: "s-lt-2", requestType: "repuestos" })
  await seedChain({ id: "dec-a-mix", ws: WS_A, submitted: "2026-12-01", approval: 1, purchase: 1, arrival: 3, second: { supplier: "s-lt-2", arrival: 9 } })
  // Faena B: 5 ítems del proveedor 1.
  for (let i = 0; i < 5; i += 1) await seedChain({ id: `dec-b-s1-${i}`, ws: WS_B, submitted: "2026-12-01", approval: 1, purchase: 1, arrival: 4 })
}, 90_000)

afterAll(async () => { await pg.close() })

describe("getSupplyLeadTime · qué ítems entran", () => {
  it("cuenta sólo ítems cerrados dentro del período: ni los abiertos ni los cerrados antes o después", async () => {
    const report = await getSupplyLeadTime(session(), OCTOBER)

    // A: 6 + a-anulada (cerrado el 4-oct con la recepción vigente) = 7; B: 5. Fuera: a-abierto, a-septiembre, a-noviembre, a-prev*.
    expect(report.overall.closedItems).toBe(12)
    expect(report.byWorksite.map((g) => [g.label, g.closedItems])).toEqual([["Faena A", 7], ["Faena B", 5]])
  })

  it("mide cada tramo entre sus hitos, con su propio n, y no publica un tramo con pocos datos", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_A] }), OCTOBER)

    const stage = (key: string) => report.overall.stages.find((s) => s.key === key)!
    // aprobación [1,1,2,2,3,3] + a-anulada (1) → 7 observaciones, mediana 2.
    expect(stage("approval")).toMatchObject({ n: 7, median: 2, insufficient: false })
    expect(stage("purchase")).toMatchObject({ n: 7, median: 2 })
    // llegada [4,5,6,7,8,9] + a-anulada (1) → mediana 6.
    expect(stage("arrival")).toMatchObject({ n: 7, median: 6 })
    // Sólo 3 ítems tienen entrega vigente: n = 3 < 5, sin cifra. La entrega ANULADA de a-anulada no suma.
    expect(stage("delivery")).toEqual(expect.objectContaining({ n: 3, median: null, insufficient: true }))
  })

  it("una recepción o entrega anulada no mueve el hito ni el cierre", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_A] }), { fromDate: "2026-10-30", toDate: "2026-10-31" })

    // Si la recepción anulada (30-oct) o la entrega anulada (31-oct) contaran, a-anulada se habría cerrado en esos días.
    expect(report.overall.closedItems).toBe(0)
  })

  it("el período de comparación trae el total de septiembre con su n", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_A] }), OCTOBER)

    // a-septiembre + 4 a-prev: 5 ítems cerrados entre el 31-ago y el 30-sep.
    expect(report.previousTotal.n).toBe(5)
    expect(report.previousTotal.insufficient).toBe(false)
  })

  it("la ventana por defecto es la misma de sus hermanas: 30 días terminando hoy", async () => {
    const report = await getSupplyLeadTime(session(), {})

    expect(report.filters.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(report.filters.fromDate < report.filters.toDate).toBe(true)
  })
})

describe("getSupplyLeadTime · alcance de faenas (A no ve B)", () => {
  it("un usuario de la faena A sólo ve ítems de A", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_A] }), OCTOBER)

    expect(report.overall.closedItems).toBe(7)
    expect(report.byWorksite.map((g) => g.label)).toEqual(["Faena A"])
  })

  it("un usuario de la faena B sólo ve B", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_B] }), OCTOBER)

    expect(report.overall.closedItems).toBe(5)
    expect(report.byWorksite.map((g) => g.label)).toEqual(["Faena B"])
    expect(report.overall.stages.find((s) => s.key === "approval")).toMatchObject({ n: 5, median: 1 })
  })

  it("sin faenas asignadas no ve nada (una lista vacía no es «sin filtro»)", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [] }), OCTOBER)

    expect(report.overall.closedItems).toBe(0)
    expect(report.byWorksite).toEqual([])
  })

  it("elegir una faena ajena no amplía el alcance", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_A] }), { ...OCTOBER, worksiteId: WS_B })

    expect(report.overall.closedItems).toBe(0)
  })

  it("un rol global puede acotar a una faena", async () => {
    const report = await getSupplyLeadTime(session(), { ...OCTOBER, worksiteId: WS_B })

    expect(report.overall.closedItems).toBe(5)
  })

  it("sin el permiso de la pantalla no hay datos: falla en vez de devolver vacío", async () => {
    await expect(getSupplyLeadTime(session({ permissions: ["purchasing:view"] }), OCTOBER)).rejects.toThrow("No autorizado")
  })
})

const DECEMBER = { fromDate: "2026-12-01", toDate: "2026-12-31" }
const S1 = "s-lt"
const S2 = "s-lt-2"
const stageOf = (report: Awaited<ReturnType<typeof getSupplyLeadTime>>, key: string) => report.overall.stages.find((stage) => stage.key === key)!

describe("getSupplyLeadTime · filtros de proveedor y tipo", () => {
  it("sin filtros cuenta todo lo cerrado en diciembre", async () => {
    const report = await getSupplyLeadTime(session(), DECEMBER)

    // A: 5 + 5 + 1 dividido; B: 5.
    expect(report.overall.closedItems).toBe(16)
    expect(report.filters).toEqual({ ...DECEMBER })
  })

  it("con proveedor deja sólo los ítems que él tuvo en una OC viva, y lo dice en los filtros aplicados", async () => {
    const report = await getSupplyLeadTime(session(), { ...DECEMBER, supplierId: S1 })

    // A: 5 de EPP + el dividido; B: 5. Los 5 del proveedor 2 quedan fuera.
    expect(report.overall.closedItems).toBe(11)
    expect(report.byWorksite.map((g) => [g.label, g.closedItems])).toEqual([["Faena A", 6], ["Faena B", 5]])
    expect(report.filters.supplierId).toBe(S1)
  })

  it("la llegada se mide sobre las OC del proveedor elegido: el ítem dividido llega distinto según a quién se le reclame", async () => {
    const withS1 = await getSupplyLeadTime(session(), { ...DECEMBER, supplierId: S1 })
    const withS2 = await getSupplyLeadTime(session(), { ...DECEMBER, supplierId: S2 })
    const withoutSupplier = await getSupplyLeadTime(session(), DECEMBER)

    // Proveedor 1: llegadas [2×5, 3 (el dividido), 4×5] → mediana 3. Proveedor 2: [10×5, 9] → mediana 10.
    expect(stageOf(withS1, "arrival")).toMatchObject({ n: 11, median: 3 })
    expect(stageOf(withS2, "arrival")).toMatchObject({ n: 6, median: 10 })
    expect(withS2.overall.closedItems).toBe(6)
    // La fila del dividido: sin filtro mide hasta la PRIMERA llegada (3 días); con el proveedor 2, la suya (9).
    const mix = (report: typeof withS1) => report.slowest.find((row) => row.itemId === "i-dec-a-mix")!
    expect(mix(withoutSupplier).stages.find((stage) => stage.key === "arrival")!.days).toBe(3)
    expect(mix(withS2).stages.find((stage) => stage.key === "arrival")!.days).toBe(9)
  })

  it("el cierre del ítem (que decide el período) no depende del proveedor elegido", async () => {
    // El dividido se cerró el 12-dic con la llegada del proveedor 2: con el proveedor 1 sigue en diciembre.
    const report = await getSupplyLeadTime(session(), { fromDate: "2026-12-12", toDate: "2026-12-12", supplierId: S1 })

    expect(report.overall.closedItems).toBe(1)
    expect(report.slowest[0]!.itemId).toBe("i-dec-a-mix")
  })

  it("un proveedor sin ítems cerrados deja todo en n = 0, no en «todo»", async () => {
    const report = await getSupplyLeadTime(session(), { ...DECEMBER, supplierId: "s-no-existe" })

    expect(report.overall.closedItems).toBe(0)
    expect(report.slowest).toEqual([])
    expect(stageOf(report, "arrival")).toMatchObject({ n: 0, insufficient: true })
  })

  it("con tipo de solicitud deja sólo ese tipo", async () => {
    const report = await getSupplyLeadTime(session(), { ...DECEMBER, requestType: "repuestos" })

    expect(report.overall.closedItems).toBe(5)
    expect(report.filters.requestType).toBe("repuestos")
  })

  it("tipo y proveedor se combinan (intersección, no unión)", async () => {
    const report = await getSupplyLeadTime(session(), { ...DECEMBER, requestType: "repuestos", supplierId: S1 })

    expect(report.overall.closedItems).toBe(0)
  })

  it("un usuario de la faena A con un proveedor elegido sigue viendo sólo la faena A", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_A] }), { ...DECEMBER, supplierId: S1 })

    expect(report.overall.closedItems).toBe(6)
    expect(report.byWorksite.map((g) => g.label)).toEqual(["Faena A"])
    expect(report.slowest.every((row) => row.worksiteName === "Faena A")).toBe(true)
  })

  it("elegir la faena ajena junto con un proveedor no amplía el alcance", async () => {
    const scoped = session({ isGlobal: false, worksiteIds: [WS_A] })

    expect((await getSupplyLeadTime(scoped, { ...DECEMBER, supplierId: S1, worksiteId: WS_B })).overall.closedItems).toBe(0)
    // Un rol global sí puede acotar a esa faena.
    expect((await getSupplyLeadTime(session(), { ...DECEMBER, supplierId: S1, worksiteId: WS_B })).overall.closedItems).toBe(5)
  })
})

describe("getSupplyLeadTime · los ítems más lentos", () => {
  it("lista los ítems cerrados con el plazo total más largo, con los días de cada tramo y los ids para enlazar", async () => {
    const report = await getSupplyLeadTime(session(), DECEMBER)

    // 5 de repuestos: 12 días; el dividido: 11; los 5 de la faena B: 6 (entran 4 hasta el tope de 10); los de EPP de A (4 días) quedan fuera.
    expect(report.slowest).toHaveLength(10)
    expect(report.slowest.slice(0, 5).map((row) => row.totalDays)).toEqual([12, 12, 12, 12, 12])
    expect(new Set(report.slowest.slice(0, 5).map((row) => row.itemId))).toEqual(new Set([0, 1, 2, 3, 4].map((i) => `i-dec-a-s2-${i}`)))
    expect(report.slowest[5]).toMatchObject({ itemId: "i-dec-a-mix", requestId: "r-dec-a-mix", totalDays: 11, worksiteName: "Faena A", productName: "Ítem sin nombre" })
    expect(report.slowest.slice(6).every((row) => row.worksiteName === "Faena B" && row.totalDays === 6)).toBe(true)
    const first = report.slowest[0]!
    expect(first.stages.map((stage) => [stage.key, stage.days])).toEqual([["approval", 1], ["purchase", 1], ["arrival", 10], ["delivery", null]])
    expect(first.requestCode).toMatch(/^SOL-LT-\d+$/)
  })

  it("usa el nombre del producto (o el texto libre) cuando existe", async () => {
    await db.insert(schema.productCategories).values({ id: "pc-lt", name: "EPP LT", slug: "epp-lt" })
    await db.insert(schema.products).values({ id: "p-lt", sku: "LT-1", name: "Casco de seguridad", categoryId: "pc-lt" })
    await db.update(schema.purchaseRequestItems).set({ productId: "p-lt" }).where(eqId("i-dec-a-s2-0"))
    await db.update(schema.purchaseRequestItems).set({ productNameFree: "Servicio de grúa" }).where(eqId("i-dec-a-s2-1"))
    const report = await getSupplyLeadTime(session(), DECEMBER)

    expect(report.slowest.find((row) => row.itemId === "i-dec-a-s2-0")!.productName).toBe("Casco de seguridad")
    expect(report.slowest.find((row) => row.itemId === "i-dec-a-s2-1")!.productName).toBe("Servicio de grúa")
  })

  it("respeta el alcance: un usuario de la faena B sólo ve ítems de la B en la lista", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [WS_B] }), DECEMBER)

    expect(report.slowest).toHaveLength(5)
    expect(report.slowest.every((row) => row.itemId.startsWith("i-dec-b-"))).toBe(true)
  })

  it("sin faenas asignadas la lista queda vacía (una lista vacía no es «sin filtro»)", async () => {
    const report = await getSupplyLeadTime(session({ isGlobal: false, worksiteIds: [] }), DECEMBER)

    expect(report.slowest).toEqual([])
  })

  it("un ítem cerrado fuera del período no entra a la lista", async () => {
    const report = await getSupplyLeadTime(session(), OCTOBER)

    expect(report.slowest.some((row) => row.itemId.startsWith("i-dec-"))).toBe(false)
    expect(report.slowest.some((row) => row.itemId === "i-a-septiembre")).toBe(false)
  })
})

describe("getItemLeadTime · la ficha de un ítem cuenta lo mismo que Analítica", () => {
  const day = (iso: string) => plainDateToDay(iso)
  const global = () => session({ permissions: ["warehouse:view_traceability"] })

  it("devuelve los cinco hitos del ítem en días civiles", async () => {
    const leadTime = await getItemLeadTime(global(), "i-a0")

    // a0: envío 1-oct, +1 aprobación (2-oct), +2 OC (4-oct), +4 llegada (8-oct), +1 entrega (9-oct).
    expect(leadTime).toEqual({
      itemId: "i-a0",
      status: "delivered",
      milestones: {
        submittedDay: day("2026-10-01"), approvedDay: day("2026-10-02"), issuedDay: day("2026-10-04"),
        arrivedDay: day("2026-10-08"), deliveredDay: day("2026-10-09"), closedDay: day("2026-10-09"),
      },
    })
  })

  it("para cada ítem de la lista de los más lentos, los días por tramo de su ficha son los mismos", async () => {
    const report = await getSupplyLeadTime(session(), OCTOBER)
    expect(report.slowest.length).toBeGreaterThan(0)

    for (const row of report.slowest) {
      const leadTime = await getItemLeadTime(global(), row.itemId)
      const view = buildItemLeadTimeView(leadTime!.milestones, leadTime!.status, day("2099-01-01"))
      // Mismo hito de partida y de llegada, mismos días: lo que Analítica lista como lento se ve igual en su ficha.
      expect(view.stages.map((stage) => stage.days), row.itemId).toEqual(row.stages.map((stage) => stage.days))
      expect(view.totalDays, row.itemId).toBe(row.totalDays)
    }
  })

  it("una recepción o entrega anulada no mueve los hitos de la ficha", async () => {
    const leadTime = await getItemLeadTime(global(), "i-a-anulada")

    // La recepción anulada (30-oct) y la entrega anulada (31-oct) no cuentan: cierra con la recepción vigente.
    expect(leadTime!.milestones.arrivedDay).toBe(day("2026-10-04"))
    expect(leadTime!.milestones.deliveredDay).toBeNull()
    expect(leadTime!.milestones.closedDay).toBe(day("2026-10-04"))
  })

  it("un ítem que aún no cerró trae su estado (la ficha decide qué tramo corre)", async () => {
    const leadTime = await getItemLeadTime(global(), "i-a-abierto")

    expect(leadTime!.status).toBe("purchased")
  })

  it("un usuario de la faena A no ve la ficha de un ítem de la B: igual que si no existiera", async () => {
    const scopedA = session({ isGlobal: false, worksiteIds: [WS_A], permissions: ["warehouse:view_traceability"] })

    expect(await getItemLeadTime(scopedA, "i-b0")).toBeNull()
    expect(await getItemLeadTime(scopedA, "i-a0")).not.toBeNull()
    expect(await getItemLeadTime(scopedA, "i-no-existe")).toBeNull()
    expect(await getItemLeadTime(session({ isGlobal: false, worksiteIds: [], permissions: ["warehouse:view_traceability"] }), "i-a0")).toBeNull()
  })

  it("sin el permiso de Seguimiento falla en vez de devolver vacío", async () => {
    await expect(getItemLeadTime(session({ permissions: ["analytics:view"] }), "i-a0")).rejects.toThrow("No autorizado")
  })
})

/** `purchase_request_items.id = …`, para los UPDATE de arriba. */
function eqId(id: string) { return eq(schema.purchaseRequestItems.id, id) }
