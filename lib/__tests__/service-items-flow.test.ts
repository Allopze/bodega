/**
 * Servicios sin precio previo — flujo de extremo a extremo contra PGlite real.
 *
 * Cubre lo que el catálogo semilla de la migración 0147 promete: mantención de
 * monogás, calibración de alcotest y vacunas se solicitan sin precio, avanzan
 * por el flujo de EPP, entran a la OC con `unit_price = NULL` (costo pendiente,
 * distinto de $0) y su costo real se registra después con traza.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { createSubmittedRequest } from "@/lib/services/requests-draft"
import { createOrder, recordOrderItemCost } from "@/lib/services/purchasing"
import { approveItem } from "@/lib/services/item-state"

const MONOGAS = "prod-srv-monogas"
const ALCOTEST = "prod-srv-alcotest"
const VACUNA = "prod-srv-vacuna"

describe("servicios con costo pendiente — flujo completo", () => {
  const now = new Date().toISOString()
  const userId = "user-srv-test"
  const worksiteId = "ws-srv-test"
  const workerId = "worker-srv-test"
  const supplierId = "sup-srv-test"

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Operador Servicios", email: "srv-test@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Servicios", code: "SRV-TEST", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.workers).values({
      id: workerId, firstName: "Ana", lastName: "Colaboradora", worksiteId, isActive: true, createdAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: supplierId, name: "Proveedor Servicios", isActive: true, createdAt: now, updatedAt: now,
    })
    // EPP normal para las solicitudes mixtas.
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-epp-srv-test", name: "EPP", slug: "epp-srv-test", isEpp: true, requiresPrevencion: false, sortOrder: 0,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-casco-srv", sku: "CASCO-SRV", name: "Casco", categoryId: "cat-epp-srv-test",
      unitOfMeasure: "unidad", isEpp: true, isService: false, requiresWorker: false,
      isActive: true, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  function requestData(items: Array<Partial<Parameters<typeof createSubmittedRequest>[2]["items"][number]>>) {
    return {
      worksiteId, requestType: "otro" as const, urgency: "normal" as const,
      requiredDate: "2026-12-01", deliveryMode: "via_oficina" as const,
      items: items.map((item, index) => ({
        productId: null, productNameFree: null, quantity: 1, unitOfMeasure: "servicio",
        urgency: "normal" as const, workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: index, attributes: [],
        ...item,
      })),
    }
  }

  const serie = (attributeId: string, value = "MG-014") => ([
    { attributeId, attributeName: "Código interno / N° de serie", value },
  ])

  // ── 1-3. Creación sin precio ────────────────────────────────────────────────

  it("el catálogo semilla trae los tres servicios marcados como is_service", async () => {
    const rows = await inMemoryDb.select().from(schema.products)
      .where(eq(schema.products.isService, true))
    const byId = new Map(rows.map((product) => [product.id, product]))

    expect(byId.get(MONOGAS)?.name).toBe("Mantención de monogás")
    expect(byId.get(ALCOTEST)?.name).toBe("Calibración de alcotest")
    expect(byId.get(VACUNA)?.name).toBe("Vacuna")
    // Ninguno lleva precio de referencia: no se inventa un costo al crear.
    for (const id of [MONOGAS, ALCOTEST, VACUNA]) {
      expect(byId.get(id)?.referencePrice).toBeNull()
    }
    // Sólo la vacuna es nominada.
    expect(byId.get(VACUNA)?.requiresWorker).toBe(true)
    expect(byId.get(MONOGAS)?.requiresWorker).toBe(false)
    expect(byId.get(ALCOTEST)?.requiresWorker).toBe(false)
  })

  it("crea una solicitud de mantención de monogás sin precio", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productId: MONOGAS, attributes: serie("pa-srv-monogas-serie") },
    ]))

    const items = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items).toHaveLength(1)
    expect(items[0]!.status).toBe("requested")
    // El ítem de solicitud no tiene columna de precio: nada que inventar.
    expect(items[0]).not.toHaveProperty("unitPrice")
  })

  it("crea una solicitud de calibración de alcotest sin precio", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productId: ALCOTEST, attributes: serie("pa-srv-alcotest-serie", "ALC-002") },
    ]))
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items[0]!.productId).toBe(ALCOTEST)
    expect(items[0]!.status).toBe("requested")
  })

  it("crea una solicitud de vacuna con colaborador y dosis, sin precio", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      {
        productId: VACUNA, workerId,
        attributes: [{ attributeId: "pa-srv-vacuna-dosis", attributeName: "Número de dosis", value: "2" }],
      },
    ]))

    const [item] = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    // Referencia al colaborador, no su nombre suelto.
    expect(item!.workerId).toBe(workerId)

    const attrs = await inMemoryDb.select().from(schema.requestItemAttributes)
      .where(eq(schema.requestItemAttributes.requestItemId, item!.id))
    expect(attrs).toEqual([expect.objectContaining({ attributeName: "Número de dosis", value: "2" })])
  })

  // ── 5-6. Validaciones de colaborador y dosis (backend = fuente de verdad) ────

  it("rechaza una vacuna sin colaborador", async () => {
    await expect(createSubmittedRequest(userId, undefined, requestData([
      {
        productId: VACUNA, workerId: null,
        attributes: [{ attributeId: "pa-srv-vacuna-dosis", attributeName: "Número de dosis", value: "1" }],
      },
    ]))).rejects.toThrow("selecciona el colaborador para Vacuna")
  })

  it("rechaza una vacuna sin número de dosis", async () => {
    await expect(createSubmittedRequest(userId, undefined, requestData([
      { productId: VACUNA, workerId, attributes: [] },
    ]))).rejects.toThrow("completa Número de dosis")
  })

  it("rechaza dosis no enteras, cero o negativas aunque el formulario las deje pasar", async () => {
    for (const value of ["0", "-2", "2.5", "dos"]) {
      await expect(createSubmittedRequest(userId, undefined, requestData([
        {
          productId: VACUNA, workerId,
          attributes: [{ attributeId: "pa-srv-vacuna-dosis", attributeName: "Número de dosis", value }],
        },
      ]))).rejects.toThrow("entero mayor o igual a 1")
    }
  })

  it("rechaza un monogás sin el código interno del equipo", async () => {
    await expect(createSubmittedRequest(userId, undefined, requestData([
      { productId: MONOGAS, attributes: [] },
    ]))).rejects.toThrow("completa Código interno / N° de serie")
  })

  // ── 12. Compatibilidad con lo existente ─────────────────────────────────────

  it("una solicitud de EPP corriente sigue creándose sin reglas nuevas", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productId: "prod-casco-srv", quantity: 3, unitOfMeasure: "unidad" },
    ]))
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items[0]!.quantity).toBe(3)
    expect(items[0]!.workerId).toBeNull()
  })

  it("un ítem fuera de catálogo no queda sujeto a reglas de producto", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productNameFree: "Servicio histórico sin catálogo", unitOfMeasure: "servicio" },
    ]))
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items[0]!.productNameFree).toBe("Servicio histórico sin catálogo")
  })

  // ── 7-11. Aprobación, compra, registro del costo y totales ──────────────────

  it("aprueba, compra sin precio, registra el costo real y recalcula los totales", async () => {
    // Solicitud mixta: EPP con precio conocido + servicio con costo pendiente.
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productId: "prod-casco-srv", quantity: 2, unitOfMeasure: "unidad" },
      { productId: MONOGAS, attributes: serie("pa-srv-monogas-serie", "MG-777") },
    ]))
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
      .orderBy(schema.purchaseRequestItems.sortOrder)
    const eppItem = items.find((i) => i.productId === "prod-casco-srv")!
    const serviceItem = items.find((i) => i.productId === MONOGAS)!

    // 7. Aprobar un ítem sin precio funciona igual que uno con precio.
    for (const item of [eppItem, serviceItem]) {
      await approveItem(item.id, userId, { userEmail: undefined })
    }
    const approved = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(approved.every((i) => i.status === "approved" || i.status === "pending_purchase")).toBe(true)

    // 8. La compra continúa con el costo del servicio sin definir.
    const orderId = await createOrder({
      worksiteId, supplierId, createdBy: userId,
      items: [
        {
          requestItemId: eppItem.id, productId: eppItem.productId, productNameFree: null,
          quantity: 2, unitOfMeasure: "unidad", unitPrice: 12_000,
        },
        {
          requestItemId: serviceItem.id, productId: serviceItem.productId, productNameFree: null,
          quantity: 1, unitOfMeasure: "servicio", unitPrice: null,
        },
      ],
    })

    const orderItems = await inMemoryDb.select().from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
    const serviceLine = orderItems.find((line) => line.requestItemId === serviceItem.id)!
    const eppLine = orderItems.find((line) => line.requestItemId === eppItem.id)!

    // Costo desconocido ≠ $0: se persiste NULL, y el subtotal lo acompaña.
    expect(serviceLine.unitPrice).toBeNull()
    expect(serviceLine.subtotal).toBeNull()
    expect(eppLine.unitPrice).toBe(12_000)
    expect(eppLine.subtotal).toBe(24_000)

    // 10. El total de la OC sólo cuenta lo conocido; no suma el servicio como 0.
    const [orderBefore] = await inMemoryDb.select().from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, orderId))
    expect(orderBefore!.netAmount).toBe(24_000)
    expect(orderBefore!.totalAmount).toBe(28_560)

    // 9. Registro posterior del costo real.
    const result = await recordOrderItemCost({
      purchaseOrderItemId: serviceLine.id,
      unitPrice: 45_000,
      userId,
      userEmail: "srv-test@chome.cl",
    })
    expect(result.pendingCostLines).toBe(0)

    const [pricedLine] = await inMemoryDb.select().from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.id, serviceLine.id))
    expect(pricedLine!.unitPrice).toBe(45_000)
    expect(pricedLine!.subtotal).toBe(45_000)
    // Traza mínima: costo real, fecha y usuario responsable.
    expect(pricedLine!.costRecordedAt).toBeTruthy()
    expect(pricedLine!.costRecordedBy).toBe(userId)

    // 10. Totales recalculados sobre las líneas vivas.
    const [orderAfter] = await inMemoryDb.select().from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, orderId))
    expect(orderAfter!.netAmount).toBe(69_000)
    expect(orderAfter!.taxAmount).toBe(13_110)
    expect(orderAfter!.totalAmount).toBe(82_110)

    // El registro entra en la auditoría existente, con el valor anterior.
    const auditRows = await inMemoryDb.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.entityType, "purchase_order_item"),
      eq(schema.auditLog.entityId, serviceLine.id),
    ))
    expect(auditRows).toHaveLength(1)
    expect(JSON.parse(auditRows[0]!.oldState!)).toMatchObject({ unitPrice: null })
    expect(JSON.parse(auditRows[0]!.newState!)).toMatchObject({ unitPrice: 45_000 })

    // 12. El historial de la solicitud no se reescribe al registrar el costo.
    const sourceItem = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.id, serviceItem.id))
    expect(sourceItem[0]!.quantity).toBe(1)
  })

  it("no deja comprar un EPP con costo pendiente", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productId: "prod-casco-srv", quantity: 1, unitOfMeasure: "unidad" },
    ]))
    const [item] = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    await approveItem(item!.id, userId, { userEmail: undefined })

    await expect(createOrder({
      worksiteId, supplierId, createdBy: userId,
      items: [{
        requestItemId: item!.id, productId: item!.productId, productNameFree: null,
        quantity: 1, unitOfMeasure: "unidad", unitPrice: null,
      }],
    })).rejects.toThrow("Solo los servicios del catálogo pueden comprarse con costo pendiente")
  })

  it("no permite reprizar por esta vía una línea que ya tenía precio acordado", async () => {
    const [line] = await inMemoryDb.select().from(schema.purchaseOrderItems)
      .where(and(
        eq(schema.purchaseOrderItems.unitPrice, 12_000),
        isNull(schema.purchaseOrderItems.costRecordedAt),
      ))
    expect(line).toBeTruthy()

    await expect(recordOrderItemCost({
      purchaseOrderItemId: line!.id, unitPrice: 1, userId,
    })).rejects.toThrow("ya tiene un precio acordado")
  })

  it("rechaza registrar el costo fuera del alcance de faenas del actor", async () => {
    const { requestId } = await createSubmittedRequest(userId, undefined, requestData([
      { productId: ALCOTEST, attributes: serie("pa-srv-alcotest-serie", "ALC-909") },
    ]))
    const [item] = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    await approveItem(item!.id, userId, { userEmail: undefined })
    const orderId = await createOrder({
      worksiteId, supplierId, createdBy: userId,
      items: [{
        requestItemId: item!.id, productId: item!.productId, productNameFree: null,
        quantity: 1, unitOfMeasure: "servicio", unitPrice: null,
      }],
    })
    const [line] = await inMemoryDb.select().from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))

    await expect(recordOrderItemCost({
      purchaseOrderItemId: line!.id, unitPrice: 30_000, userId,
      worksiteScope: ["ws-otra-faena"],
    })).rejects.toThrow("No tienes acceso a la faena de esta orden")

    // Con alcance válido sí procede.
    await expect(recordOrderItemCost({
      purchaseOrderItemId: line!.id, unitPrice: 30_000, userId,
      worksiteScope: [worksiteId],
    })).resolves.toMatchObject({ pendingCostLines: 0 })
  })

  it("la base rechaza un precio sin subtotal (o al revés)", async () => {
    const [anyLine] = await inMemoryDb.select().from(schema.purchaseOrderItems).limit(1)
    await expect(
      inMemoryDb.update(schema.purchaseOrderItems)
        .set({ unitPrice: 100, subtotal: null })
        .where(eq(schema.purchaseOrderItems.id, anyLine!.id)),
    ).rejects.toThrow()
  })
})
