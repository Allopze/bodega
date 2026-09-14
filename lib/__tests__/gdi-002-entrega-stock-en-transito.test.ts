/**
 * GDI-002 (auditoría 2026-09-14): el traslado interno Oficina → Faena mueve el
 * stock AL DESPACHAR, no al cotejar. Entre una cosa y la otra la mercadería
 * viaja en un camión pero contablemente ya está en la faena: figura en
 * `worksite_stock`, cuenta como disponible y es entregable a un trabajador
 * antes de haber llegado. El sistema no lo impedía ni lo decía; lo detectaba
 * DESPUÉS, con el caso `DELIVERY_BEFORE_FAENA_RECEIPT` de trazabilidad.
 *
 * Estas pruebas fallan sin el arreglo: antes la entrega se registraba en
 * silencio y nada —ni el mensaje ni la auditoría— mencionaba el tránsito.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, desc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const { registerWorkerStockDelivery } = await import("@/lib/services/deliveries-worker-stock")

const USER_ID = "user-gdi-002"
let scenarioNumber = 0

/**
 * Una faena con 5 unidades en su saldo, de las cuales `enTransito` vienen en
 * una guía despachada y sin cotejar. Ese es exactamente el estado que el
 * hallazgo describe: el saldo no distingue "tengo" de "viene en camino".
 */
async function makeScenario({ guideStatus = "dispatched" as string, dispatched = 5, received = 0 } = {}) {
  const suffix = String(++scenarioNumber)
  const now = new Date().toISOString()
  const officeId = `ws-oficina-${suffix}`
  const faenaId = `ws-faena-${suffix}`
  const workerId = `wk-${suffix}`
  const categoryId = `cat-${suffix}`
  const productId = `prod-${suffix}`

  await inMemoryDb.insert(schema.worksites).values([
    { id: officeId, name: `Oficina ${suffix}`, code: `OF-${suffix}`, isActive: true, createdAt: now, updatedAt: now },
    { id: faenaId, name: `Faena ${suffix}`, code: `FN-${suffix}`, isActive: true, createdAt: now, updatedAt: now },
  ])
  await inMemoryDb.insert(schema.workers).values({
    id: workerId, firstName: "Ana", lastName: `Terreno ${suffix}`,
    worksiteId: faenaId, isActive: true, createdAt: now,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: categoryId, name: `Categoría ${suffix}`, slug: `categoria-${suffix}`, sortOrder: 0,
  })
  await inMemoryDb.insert(schema.products).values({
    id: productId, sku: `GDI-${suffix}`, name: `Casco ${suffix}`,
    categoryId, unitOfMeasure: "unidad", isActive: true, isService: false, isEpp: true,
    createdAt: now, updatedAt: now,
  })
  // El saldo de la faena es el que dejó el despacho: 5 unidades que aún viajan.
  await inMemoryDb.insert(schema.worksiteStock).values({
    id: `stock-${suffix}`, worksiteId: faenaId, productId,
    quantity: 5, minStock: 0, lastMovementAt: now, updatedAt: now,
  })

  const guideId = `gdi-${suffix}`
  const isDispatched = guideStatus !== "draft"
  const isReceived = guideStatus === "received" || guideStatus === "partially_received"
  await inMemoryDb.insert(schema.dispatchGuides).values({
    id: guideId, code: `GDI-${suffix.padStart(6, "0")}`, status: guideStatus,
    originWorksiteId: officeId, destinationWorksiteId: faenaId,
    issuedBy: USER_ID, issuedAt: now,
    dispatchedAt: isDispatched ? now : null,
    dispatchedBy: isDispatched ? USER_ID : null,
    receivedAt: isReceived ? now : null,
    receivedBy: isReceived ? USER_ID : null,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.dispatchGuideItems).values({
    id: `gdi-item-${suffix}`, guideId, productId,
    quantity: dispatched, quantityReceived: received > 0 ? received : null,
    unitOfMeasure: "unidad", sortOrder: 0,
  })

  return { faenaId, workerId, productId }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Bodeguero", email: "gdi002@chome.cl",
    hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
  })
})

afterAll(async () => { await pg.close() })

async function deliver(scenario: { faenaId: string; workerId: string; productId: string }, quantity: number) {
  const warnings: string[] = []
  const deliveryId = await registerWorkerStockDelivery({
    sourceWorksiteId: scenario.faenaId,
    workerId: scenario.workerId,
    deliveredBy: USER_ID,
    items: [{ productId: scenario.productId, quantity }],
  }, "all", { onInTransitWarning: (warning) => warnings.push(warning) })
  return { deliveryId, warnings }
}

describe("GDI-002 — la disponibilidad para entregar descuenta lo que viaja", () => {
  it("avisa con la cifra en tránsito cuando lo entregado no ha llegado a la faena", async () => {
    const scenario = await makeScenario()

    const { warnings } = await deliver(scenario, 3)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/todavía viaja/i)
    // La cifra concreta es lo que convierte el aviso en accionable.
    expect(warnings[0]).toContain("5 en tránsito de 5 en saldo")
  })

  it("registra la entrega igual: advierte, no bloquea", async () => {
    const scenario = await makeScenario()

    const { deliveryId } = await deliver(scenario, 3)

    const [row] = await inMemoryDb.select().from(schema.deliveries).where(eq(schema.deliveries.id, deliveryId))
    expect(row?.id).toBe(deliveryId)
    const [stock] = await inMemoryDb.select().from(schema.worksiteStock).where(and(
      eq(schema.worksiteStock.worksiteId, scenario.faenaId),
      eq(schema.worksiteStock.productId, scenario.productId),
    ))
    expect(stock?.quantity).toBe(2)
  })

  it("deja el tránsito escrito en la auditoría de la entrega", async () => {
    const scenario = await makeScenario()

    const { deliveryId } = await deliver(scenario, 3)

    const [audit] = await inMemoryDb.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "delivery"), eq(schema.auditLog.entityId, deliveryId)))
      .orderBy(desc(schema.auditLog.createdAt))
    expect((audit?.newState as Record<string, unknown>)?.entregadoConStockEnTransito).toMatch(/todavía viaja/i)
  })

  it("no avisa cuando la guía ya fue cotejada: eso sí llegó", async () => {
    const scenario = await makeScenario({ guideStatus: "received", dispatched: 5, received: 5 })

    const { warnings } = await deliver(scenario, 3)

    expect(warnings).toEqual([])
  })

  it("no avisa mientras la entrega cabe en lo que ya llegó", async () => {
    // 5 despachadas, 4 cotejadas: sólo 1 viaja, y entregar 3 no la necesita.
    const scenario = await makeScenario({ guideStatus: "partially_received", dispatched: 5, received: 4 })

    const { warnings } = await deliver(scenario, 3)

    expect(warnings).toEqual([])
  })

  it("avisa cuando la entrega excede lo cotejado aunque parte ya haya llegado", async () => {
    const scenario = await makeScenario({ guideStatus: "partially_received", dispatched: 5, received: 1 })

    const { warnings } = await deliver(scenario, 3)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("4 en tránsito de 5 en saldo")
  })
})
