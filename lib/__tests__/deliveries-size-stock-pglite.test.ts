/**
 * Integridad del inventario por talla en la entrega a trabajador.
 *
 * En esta plataforma la variante **es** el producto: una fila de `products` por
 * talla, y `worksite_stock` es (faena, producto). Esta prueba corre contra un
 * Postgres real —no mocks— porque lo que hay que demostrar es justamente lo que
 * sólo la base garantiza: que el descuento cae en la talla elegida, que no toca
 * las hermanas, que no cruza faenas y que el CHECK impide un saldo negativo.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
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

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}))

const { registerWorkerStockDelivery } = await import("@/lib/services/deliveries-worker-stock")
const { voidWorkerStockDelivery } = await import("@/lib/services/deliveries-void")

const now = new Date().toISOString()
const FAENA = "ws-size-faena"
const OTRA_FAENA = "ws-size-otra"
const USER = "user-size"

/** Zapato de seguridad: una variante por talla, todas de la misma familia. */
const SHOE_SIZES = ["40", "41", "42"] as const
const shoeId = (size: string) => `prod-shoe-${size}`

/** Saldo de una variante en una faena. */
async function stockOf(productId: string, worksiteId = FAENA): Promise<number> {
  const [row] = await inMemoryDb
    .select({ quantity: schema.worksiteStock.quantity })
    .from(schema.worksiteStock)
    .where(and(
      eq(schema.worksiteStock.worksiteId, worksiteId),
      eq(schema.worksiteStock.productId, productId),
    ))
  return row?.quantity ?? 0
}

async function allShoeStock(worksiteId = FAENA) {
  const entries = await Promise.all(
    SHOE_SIZES.map(async (size) => [size, await stockOf(shoeId(size), worksiteId)] as const),
  )
  return Object.fromEntries(entries)
}

function deliver(items: Array<{ productId: string; quantity: number }>, sourceWorksiteId = FAENA) {
  return registerWorkerStockDelivery({
    sourceWorksiteId,
    workerId: "worker-size",
    deliveredBy: USER,
    deliveredAt: undefined,
    receiverName: null,
    notes: null,
    proofAttachment: null,
    items: items.map((item) => ({ ...item, requestItemId: null, notes: null })),
  })
}

/**
 * Saldo conocido antes de cada caso: 40 → 2, 41 → 4, 42 → 3 en la faena, y
 * 42 → 9 en otra faena para probar que no se cruzan.
 */
async function resetStock() {
  await inMemoryDb.delete(schema.stockReturns)
  await inMemoryDb.delete(schema.deliveryItems)
  await inMemoryDb.delete(schema.deliveries)
  await inMemoryDb.delete(schema.inventoryMovements)
  await inMemoryDb.delete(schema.worksiteStock)
  await inMemoryDb.insert(schema.worksiteStock).values([
    { id: "st-40", worksiteId: FAENA, productId: shoeId("40"), quantity: 2, minStock: 0, updatedAt: now },
    { id: "st-41", worksiteId: FAENA, productId: shoeId("41"), quantity: 4, minStock: 0, updatedAt: now },
    { id: "st-42", worksiteId: FAENA, productId: shoeId("42"), quantity: 3, minStock: 0, updatedAt: now },
    { id: "st-42-otra", worksiteId: OTRA_FAENA, productId: shoeId("42"), quantity: 9, minStock: 0, updatedAt: now },
  ])
}

describe("entrega por talla — integridad del stock", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

    await inMemoryDb.insert(schema.users).values({
      id: USER, email: "bodega@chome.cl", name: "Bodega", hashedPassword: "x",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-size", name: "EPP tallas", slug: "cat-size", isEpp: true,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: FAENA, name: "Faena Centinela", code: "SIZE-1", isActive: true, createdAt: now, updatedAt: now },
      { id: OTRA_FAENA, name: "Faena Arauco", code: "SIZE-2", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.eppProductFamilies).values({
      id: "fam-shoe", categoryId: "cat-size", canonicalName: "Zapato de seguridad SteelPro",
      identityKey: "zapato-steelpro", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.workers).values({
      id: "worker-size", worksiteId: FAENA, firstName: "Juan", lastName: "Pérez",
      rut: "12.345.678-9", sizeShoe: "42", isActive: true, createdAt: now,
    })

    // Una fila de catálogo por talla. Comparten nombre a propósito: es lo que
    // deja el importador, que saca la talla del nombre y la guarda como atributo.
    await inMemoryDb.insert(schema.products).values(SHOE_SIZES.map((size) => ({
      id: shoeId(size), sku: `EPP-ZAP-${size}`, name: "Zapato de seguridad SteelPro",
      categoryId: "cat-size", familyId: "fam-shoe", isEpp: true, isActive: true,
      unitOfMeasure: "unidad", createdAt: now, updatedAt: now,
    })))
    await inMemoryDb.insert(schema.productAttributes).values(SHOE_SIZES.map((size) => ({
      id: `attr-shoe-${size}`, productId: shoeId(size), categoryId: null,
      name: "Talla calzado", type: "select", isRequired: true,
      options: JSON.stringify([size]), sizeFamily: "calzado", sortOrder: 0,
    })))
  })

  beforeEach(resetStock)

  it("descuenta la talla entregada y deja intactas las demás", async () => {
    await deliver([{ productId: shoeId("42"), quantity: 1 }])
    expect(await allShoeStock()).toEqual({ "40": 2, "41": 4, "42": 2 })
  })

  it("no toca el stock de la misma talla en otra faena", async () => {
    await deliver([{ productId: shoeId("42"), quantity: 3 }])
    expect(await stockOf(shoeId("42"), FAENA)).toBe(0)
    expect(await stockOf(shoeId("42"), OTRA_FAENA)).toBe(9)
  })

  it("registra el movimiento contra la variante, no contra la familia", async () => {
    await deliver([{ productId: shoeId("42"), quantity: 2 }])
    const movements = await inMemoryDb
      .select({
        productId: schema.inventoryMovements.productId,
        quantity: schema.inventoryMovements.quantity,
        stockBefore: schema.inventoryMovements.stockBefore,
        stockAfter: schema.inventoryMovements.stockAfter,
        type: schema.inventoryMovements.type,
      })
      .from(schema.inventoryMovements)
    expect(movements).toEqual([{
      productId: shoeId("42"), quantity: -2, stockBefore: 3, stockAfter: 1, type: "egreso_entrega",
    }])
  })

  it("guarda en la entrega la variante entregada, que es lo que fija la talla", async () => {
    await deliver([{ productId: shoeId("41"), quantity: 1 }])
    const [item] = await inMemoryDb
      .select({ productId: schema.deliveryItems.productId, quantity: schema.deliveryItems.quantity })
      .from(schema.deliveryItems)
    expect(item).toEqual({ productId: shoeId("41"), quantity: 1 })
  })

  it("acepta una entrega parcial y deja el resto disponible en esa talla", async () => {
    await deliver([{ productId: shoeId("41"), quantity: 1 }])
    await deliver([{ productId: shoeId("41"), quantity: 2 }])
    expect(await stockOf(shoeId("41"))).toBe(1)
  })

  it("entrega varias tallas del mismo producto en un solo documento", async () => {
    await deliver([
      { productId: shoeId("40"), quantity: 2 },
      { productId: shoeId("42"), quantity: 1 },
    ])
    expect(await allShoeStock()).toEqual({ "40": 0, "41": 4, "42": 2 })
  })

  it("rechaza más unidades de las que hay en esa talla, aunque la familia sume más", async () => {
    // 40 tiene 2 unidades; la familia suma 9. El límite es el de la talla.
    await expect(deliver([{ productId: shoeId("40"), quantity: 3 }]))
      .rejects.toThrow(/Stock insuficiente/)
    expect(await allShoeStock()).toEqual({ "40": 2, "41": 4, "42": 3 })
  })

  it("nunca deja el saldo de una talla en negativo", async () => {
    await expect(deliver([{ productId: shoeId("42"), quantity: 4 }])).rejects.toThrow()
    expect(await stockOf(shoeId("42"))).toBe(3)
  })

  it("revierte la entrega completa si una de las tallas no tiene stock", async () => {
    // La cabecera, las líneas y los movimientos comparten transacción: una
    // línea inválida no puede dejar la otra talla descontada.
    await expect(deliver([
      { productId: shoeId("41"), quantity: 1 },
      { productId: shoeId("40"), quantity: 99 },
    ])).rejects.toThrow(/Stock insuficiente/)

    expect(await allShoeStock()).toEqual({ "40": 2, "41": 4, "42": 3 })
    expect(await inMemoryDb.select().from(schema.deliveries)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.inventoryMovements)).toHaveLength(0)
  })

  it("rechaza entregar una variante desde una faena sin ese stock", async () => {
    // El `productId` viene del cliente: entregar la talla 40 desde una faena
    // que no la tiene no puede crear stock ni descontarlo de la otra.
    await expect(deliver([{ productId: shoeId("40"), quantity: 1 }], OTRA_FAENA))
      .rejects.toThrow()
    expect(await stockOf(shoeId("40"), FAENA)).toBe(2)
  })

  it("rechaza una variante inactiva del catálogo", async () => {
    // Desactivar una talla es el mecanismo no destructivo: el histórico y el
    // saldo siguen existiendo, pero ya no se puede entregar.
    await inMemoryDb.update(schema.products)
      .set({ isActive: false })
      .where(eq(schema.products.id, shoeId("40")))
    try {
      await expect(deliver([{ productId: shoeId("40"), quantity: 1 }]))
        .rejects.toThrow("Producto no disponible")
      expect(await stockOf(shoeId("40"))).toBe(2)
    } finally {
      await inMemoryDb.update(schema.products)
        .set({ isActive: true })
        .where(eq(schema.products.id, shoeId("40")))
    }
  })

  it("rechaza repetir la misma talla dos veces en una entrega", async () => {
    await expect(deliver([
      { productId: shoeId("42"), quantity: 2 },
      { productId: shoeId("42"), quantity: 2 },
    ])).rejects.toThrow("No repitas un producto en la misma entrega")
    expect(await stockOf(shoeId("42"))).toBe(3)
  })

  it("exige cantidades enteras de EPP en cualquier talla", async () => {
    await expect(deliver([{ productId: shoeId("42"), quantity: 1.5 }]))
      .rejects.toThrow("Los EPP se entregan en cantidades enteras")
    expect(await stockOf(shoeId("42"))).toBe(3)
  })

  it("dos entregas simultáneas de la última unidad: sólo una gana", async () => {
    await inMemoryDb.update(schema.worksiteStock)
      .set({ quantity: 1 })
      .where(and(
        eq(schema.worksiteStock.worksiteId, FAENA),
        eq(schema.worksiteStock.productId, shoeId("42")),
      ))

    const results = await Promise.allSettled([
      deliver([{ productId: shoeId("42"), quantity: 1 }]),
      deliver([{ productId: shoeId("42"), quantity: 1 }]),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(await stockOf(shoeId("42"))).toBe(0)
  })

  it("una devolución vuelve a la misma talla y no al stock genérico", async () => {
    await deliver([{ productId: shoeId("42"), quantity: 2 }])
    expect(await stockOf(shoeId("42"))).toBe(1)

    const { applyMovement } = await import("@/lib/services/stock")
    await applyMovement({
      worksiteId: FAENA,
      productId: shoeId("42"),
      type: "ingreso_devolucion",
      quantity: 1,
      performedBy: USER,
      reason: "Devolución de zapato talla 42",
    })

    expect(await allShoeStock()).toEqual({ "40": 2, "41": 4, "42": 2 })
  })

  it("un traslado entre faenas conserva la talla en origen y destino", async () => {
    const { applyMovement } = await import("@/lib/services/stock")
    await applyMovement({
      worksiteId: FAENA, productId: shoeId("41"), type: "egreso_traslado",
      quantity: -3, performedBy: USER, reason: "Traslado a Faena Arauco",
    })
    await applyMovement({
      worksiteId: OTRA_FAENA, productId: shoeId("41"), type: "ingreso_traslado",
      quantity: 3, performedBy: USER, reason: "Traslado desde Faena Centinela",
    })

    expect(await stockOf(shoeId("41"), FAENA)).toBe(1)
    expect(await stockOf(shoeId("41"), OTRA_FAENA)).toBe(3)
    // El resto de las tallas no se movió en ninguna de las dos faenas.
    expect(await stockOf(shoeId("42"), FAENA)).toBe(3)
    expect(await stockOf(shoeId("42"), OTRA_FAENA)).toBe(9)
  })
})

/**
 * El resolvedor que alimenta las cuatro pantallas que listan productos de
 * catálogo (stock/kardex, export de stock, export de entregas, comprobante).
 */
describe("getProductSizesByIds", () => {
  it("devuelve la talla de cada variante en una sola consulta", async () => {
    const { getProductSizesByIds } = await import("@/lib/services/product-sizes")
    const sizes = await getProductSizesByIds(SHOE_SIZES.map(shoeId))

    expect([...sizes.entries()].map(([id, size]) => [id, size.label, size.attributeName])).toEqual([
      [shoeId("40"), "40", "Talla calzado"],
      [shoeId("41"), "41", "Talla calzado"],
      [shoeId("42"), "42", "Talla calzado"],
    ])
    expect(sizes.get(shoeId("42"))?.sizeFamily).toBe("calzado")
  })

  it("omite del mapa los productos sin talla en vez de inventar una etiqueta", async () => {
    const { getProductSizesByIds } = await import("@/lib/services/product-sizes")
    await inMemoryDb.insert(schema.products).values({
      id: "prod-casco", sku: "EPP-CASCO", name: "Casco de seguridad",
      categoryId: "cat-size", isEpp: true, isActive: true,
      unitOfMeasure: "unidad", createdAt: now, updatedAt: now,
    })
    try {
      const sizes = await getProductSizesByIds(["prod-casco", shoeId("41")])
      expect(sizes.has("prod-casco")).toBe(false)
      expect(sizes.get(shoeId("41"))?.label).toBe("41")
    } finally {
      await inMemoryDb.delete(schema.products).where(eq(schema.products.id, "prod-casco"))
    }
  })

  it("no consulta nada con una lista vacía o sólo con ids falsos", async () => {
    const { getProductSizesByIds } = await import("@/lib/services/product-sizes")
    expect(await getProductSizesByIds([])).toEqual(new Map())
    expect(await getProductSizesByIds(["", ""])).toEqual(new Map())
  })

  it("deduplica los ids repetidos que traen las filas de stock", async () => {
    const { getProductSizesByIds } = await import("@/lib/services/product-sizes")
    // Una misma variante aparece una vez por faena en la consulta de stock.
    const sizes = await getProductSizesByIds([shoeId("42"), shoeId("42"), shoeId("42")])
    expect(sizes.size).toBe(1)
    expect(sizes.get(shoeId("42"))?.label).toBe("42")
  })
})

/**
 * Anulación de una entrega. Anular no es devolver: dice que la entrega nunca
 * debió registrarse, así que repone el stock de la variante exacta y deja de
 * contar como entregada, sin borrar el documento.
 */
describe("anulación de una entrega", () => {
  const MOTIVO = "Se registró la talla equivocada en la entrega"

  beforeEach(resetStock)

  async function deliverAndGetId(productId: string, quantity: number) {
    await deliver([{ productId, quantity }])
    const [row] = await inMemoryDb
      .select({ id: schema.deliveries.id })
      .from(schema.deliveries)
    return row!.id
  }

  it("repone el stock en la misma talla entregada", async () => {
    const id = await deliverAndGetId(shoeId("42"), 2)
    expect(await stockOf(shoeId("42"))).toBe(1)

    await voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER })

    expect(await allShoeStock()).toEqual({ "40": 2, "41": 4, "42": 3 })
  })

  it("no toca las tallas hermanas ni el stock de otra faena", async () => {
    const id = await deliverAndGetId(shoeId("42"), 1)
    await voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER })

    expect(await stockOf(shoeId("40"))).toBe(2)
    expect(await stockOf(shoeId("41"))).toBe(4)
    expect(await stockOf(shoeId("42"), OTRA_FAENA)).toBe(9)
  })

  it("emite un movimiento propio de anulación, no una devolución", async () => {
    // Disfrazarlo de devolución haría creer al kardex que el material volvió
    // físicamente, cuando lo que pasó es que la entrega estaba mal registrada.
    const id = await deliverAndGetId(shoeId("42"), 2)
    await voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER })

    const movements = await inMemoryDb
      .select({
        type: schema.inventoryMovements.type,
        productId: schema.inventoryMovements.productId,
        quantity: schema.inventoryMovements.quantity,
        stockBefore: schema.inventoryMovements.stockBefore,
        stockAfter: schema.inventoryMovements.stockAfter,
      })
      .from(schema.inventoryMovements)
      .orderBy(schema.inventoryMovements.performedAt)

    expect(movements).toHaveLength(2)
    expect(movements[0]).toMatchObject({ type: "egreso_entrega", quantity: -2 })
    expect(movements[1]).toMatchObject({
      type: "ingreso_anulacion", productId: shoeId("42"), quantity: 2, stockBefore: 1, stockAfter: 3,
    })
  })

  it("no borra la entrega: la marca con responsable y motivo", async () => {
    const id = await deliverAndGetId(shoeId("41"), 1)
    await voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER })

    const [delivery] = await inMemoryDb
      .select({
        voidedAt: schema.deliveries.voidedAt,
        voidedBy: schema.deliveries.voidedBy,
        voidReason: schema.deliveries.voidReason,
      })
      .from(schema.deliveries)
      .where(eq(schema.deliveries.id, id))
    expect(delivery?.voidedAt).toBeTruthy()
    expect(delivery?.voidedBy).toBe(USER)
    expect(delivery?.voidReason).toBe(MOTIVO)

    // Las líneas siguen ahí: el comprobante histórico se puede seguir leyendo.
    const items = await inMemoryDb
      .select().from(schema.deliveryItems).where(eq(schema.deliveryItems.deliveryId, id))
    expect(items).toHaveLength(1)
  })

  it("exige un motivo de al menos 10 caracteres", async () => {
    const id = await deliverAndGetId(shoeId("42"), 1)
    await expect(voidWorkerStockDelivery({ deliveryId: id, reason: "error", voidedBy: USER }))
      .rejects.toThrow(/motivo/i)
    expect(await stockOf(shoeId("42"))).toBe(2)
  })

  it("no se puede anular dos veces", async () => {
    // Sin esta guarda la segunda anulación repondría el stock por segunda vez.
    const id = await deliverAndGetId(shoeId("42"), 2)
    await voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER })
    await expect(voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER }))
      .rejects.toThrow("Esta entrega ya fue anulada")
    expect(await stockOf(shoeId("42"))).toBe(3)
  })

  it("dos anulaciones simultáneas reponen el stock una sola vez", async () => {
    const id = await deliverAndGetId(shoeId("42"), 2)
    const results = await Promise.allSettled([
      voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER }),
      voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER }),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await stockOf(shoeId("42"))).toBe(3)
  })

  it("rechaza anular desde una bodega fuera del alcance del usuario", async () => {
    const id = await deliverAndGetId(shoeId("42"), 1)
    await expect(voidWorkerStockDelivery(
      { deliveryId: id, reason: MOTIVO, voidedBy: USER },
      [OTRA_FAENA],
    )).rejects.toThrow(/acceso/i)
    expect(await stockOf(shoeId("42"))).toBe(2)
  })

  it("revierte la anulación completa si una línea falla", async () => {
    const id = await deliverAndGetId(shoeId("42"), 1)
    await inMemoryDb.update(schema.worksites)
      .set({ isActive: false })
      .where(eq(schema.worksites.id, FAENA))
    try {
      await expect(voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER }))
        .rejects.toThrow(/inactiva/i)
      const [delivery] = await inMemoryDb
        .select({ voidedAt: schema.deliveries.voidedAt })
        .from(schema.deliveries).where(eq(schema.deliveries.id, id))
      expect(delivery?.voidedAt).toBeNull()
      expect(await stockOf(shoeId("42"))).toBe(2)
    } finally {
      await inMemoryDb.update(schema.worksites)
        .set({ isActive: true })
        .where(eq(schema.worksites.id, FAENA))
    }
  })

  it("libera el saldo para volver a entregar la misma talla", async () => {
    const id = await deliverAndGetId(shoeId("42"), 3)
    expect(await stockOf(shoeId("42"))).toBe(0)

    await voidWorkerStockDelivery({ deliveryId: id, reason: MOTIVO, voidedBy: USER })

    // La entrega correcta se puede registrar de inmediato.
    await deliver([{ productId: shoeId("42"), quantity: 1 }])
    expect(await stockOf(shoeId("42"))).toBe(2)
  })
})
