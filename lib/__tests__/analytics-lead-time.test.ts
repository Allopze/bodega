import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
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

/**
 * CHART-029 · plazos del ciclo de abastecimiento. La parte numérica (medianas, P90, n, «datos
 * insuficientes») la prueba `lead-time-shape.test.ts`; acá se prueba lo que sólo Postgres decide:
 *
 *  - qué ítems entran (sólo cerrados, por su último movimiento, dentro del período);
 *  - de qué tablas sale cada hito y qué se descarta (recepciones y entregas anuladas, OC no emitidas);
 *  - el alcance de faenas: un usuario de la faena A no ve la B.
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
    id: `r-${chain.id}`, code: `SOL-LT-${seq}`, worksiteId: chain.ws, requesterId: USER, requestType: "epp", status: "closed", submittedAt: day(chain.submitted),
  })
  await db.insert(schema.purchaseRequestItems).values({ id: `i-${chain.id}`, requestId: `r-${chain.id}`, quantity: 1, status })
  await db.insert(schema.approvalDecisions).values([
    // La primera aprobación manda; una segunda decisión posterior no mueve el hito.
    { id: `ad-${chain.id}`, requestItemId: `i-${chain.id}`, requestId: `r-${chain.id}`, type: "approve", decidedBy: USER, decidedAt: day(approvedAt) },
    { id: `ad2-${chain.id}`, requestItemId: `i-${chain.id}`, requestId: `r-${chain.id}`, type: "approve", decidedBy: USER, decidedAt: day(plus(approvedAt, 5)) },
  ])
  await db.insert(schema.purchaseOrders).values({
    id: `oc-${chain.id}`, code: `OC-LT-${seq}`, worksiteId: chain.ws, supplierId: "s-lt", createdBy: USER, status: "received",
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
  await db.insert(schema.suppliers).values({ id: "s-lt", name: "Proveedor LT" })

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
  // La recepción anulada es posterior (30-oct): el ítem se cerró con la vigente (el 7-oct) y no se mueve.
  await seedChain({ id: "a-anulada", ws: WS_A, submitted: "2026-10-01", approval: 1, purchase: 1, arrival: 1, voidedReceiptAt: "2026-10-30", voidedDeliveryAt: "2026-10-31" })
  // Más ítems de septiembre en A: el período anterior (31-ago → 30-sep) llega a n = 5 con el de arriba + 4.
  for (let i = 0; i < 4; i += 1) await seedChain({ id: `a-prev${i}`, ws: WS_A, submitted: "2026-09-01", approval: 1, purchase: 1, arrival: 3 })
}, 90_000)

afterAll(async () => { await pg.close() })

describe("getSupplyLeadTime · qué ítems entran", () => {
  it("cuenta sólo ítems cerrados dentro del período: ni los abiertos ni los cerrados antes o después", async () => {
    const report = await getSupplyLeadTime(session(), OCTOBER)

    // A: 6 + a-anulada (cerrado el 7-oct con la recepción vigente) = 7; B: 5. Fuera: a-abierto, a-septiembre, a-noviembre, a-prev*.
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
