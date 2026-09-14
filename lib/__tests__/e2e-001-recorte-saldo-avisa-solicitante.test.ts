/**
 * `E2E-001` (auditoría 2026-09-14) — el solicitante se entera cuando su saldo se recorta.
 *
 * La cadena de adquisición tiene TRES puntos donde lo pedido deja de avanzar
 * entero. Cada uno estaba bien resuelto dentro de su módulo y ninguno se lo
 * decía a quien pidió el material: el solicitante recibía aviso cuando su ítem
 * llegaba a oficina y cuando llegaba COMPLETO a faena, nunca cuando el saldo se
 * perdía por rechazo, daño, cierre parcial de la OC o merma de traslado.
 *
 * Estas pruebas fijan el aviso en los tres puntos y —lo que hace de esto una
 * costura y no tres arreglos sueltos— que un mismo recorte recorrido por dos
 * puntos distintos produzca UN solo aviso.
 *
 * Las notificaciones se insertan de verdad (no se mockea `notifyManyUser`):
 * la deduplicación entre puntos se apoya en el índice único parcial
 * `notifications_user_dedupe_unique`, y mockear el emisor la escondería.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { and, eq } from "drizzle-orm"
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
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

// El correo no es parte del contrato que se prueba acá; sólo estorbaría.
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => {}),
  sendBatchEmails: vi.fn(async () => {}),
  getAppBaseUrl: () => "http://localhost:3000",
}))

/**
 * `notifyAfterCommit` difiere al microtask; en la prueba hay que poder esperar
 * el aviso. Se conserva el resto del barrel REAL para que la notificación entre
 * a la base y la deduplicación por índice único se ejerza de verdad.
 */
const notifyState = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }))
vi.mock("@/lib/services/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/notifications")>()
  return {
    ...actual,
    notifyAfterCommit: (thunk: () => unknown) => {
      notifyState.pending.push(Promise.resolve().then(thunk))
    },
  }
})

import { registerReceipt } from "@/lib/services/receiving"
import { closeOrder } from "@/lib/services/purchasing-module/receiving"
import {
  confirmDispatchGuideReceipt,
  dispatchDispatchGuide,
  getDispatchGuideDetail,
} from "@/lib/services/dispatch-guides"

const now = new Date().toISOString()
const OFFICE = "ws-oficina-e2e"
const FAENA = "ws-faena-e2e"
const ACTOR_ID = "u-bodega-e2e"
const REQUESTER_ID = "u-solicitante-e2e"
const PRODUCT_ID = "p-e2e"

/** Espera a que se drenen los avisos diferidos y devuelve los del solicitante. */
async function shortfallNotificationsForRequester() {
  await Promise.all(notifyState.pending)
  notifyState.pending.length = 0
  return inMemoryDb.query.notifications.findMany({
    where: and(
      eq(schema.notifications.userId, REQUESTER_ID),
      eq(schema.notifications.type, "request_item_shortfall"),
    ),
  })
}

let counter = 0
async function makeOrder(quantity: number, deliveryMode: "via_oficina" | "directo_faena") {
  const suffix = ++counter
  const requestId = `req-e2e-${suffix}`
  const requestItemId = `reqi-e2e-${suffix}`
  const orderId = `oc-e2e-${suffix}`
  const orderItemId = `oci-e2e-${suffix}`
  const orderCode = `OC-E2E-${suffix}`
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `SOL-E2E-${suffix}`, worksiteId: FAENA, requesterId: REQUESTER_ID,
    requestType: "epp", urgency: "normal", status: "in_purchasing", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseRequestItems).values({
    id: requestItemId, requestId, productId: PRODUCT_ID, quantity, unitOfMeasure: "unidad",
    status: "purchased", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: orderId, code: orderCode, worksiteId: FAENA, supplierId: "sup-e2e", createdBy: ACTOR_ID,
    status: "sent", deliveryMode, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.purchaseOrderItems).values({
    id: orderItemId, purchaseOrderId: orderId, requestItemId, productId: PRODUCT_ID,
    quantity, unitOfMeasure: "unidad", status: "issued",
  })
  return { requestId, requestItemId, orderId, orderItemId, orderCode }
}

describe("E2E-001 — los tres puntos de recorte avisan al solicitante", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.users).values([
      { id: ACTOR_ID, name: "Bodeguero", email: "bodega-e2e@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: REQUESTER_ID, name: "Solicitante", email: "solicitante-e2e@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.worksites).values([
      { id: OFFICE, name: "Oficina", code: "OF-E2E", isActive: true, createdAt: now, updatedAt: now },
      { id: FAENA, name: "Faena E2E", code: "FA-E2E", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({ id: "cat-e2e", name: "General E2E", slug: "general-e2e", sortOrder: 1 })
    await inMemoryDb.insert(schema.products).values({
      id: PRODUCT_ID, sku: "E2E-001", name: "Casco de seguridad", categoryId: "cat-e2e",
      unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({ id: "sup-e2e", name: "Proveedor E2E", isActive: true, createdAt: now, updatedAt: now })
  })

  afterAll(async () => { await pg.close() })

  // Cada caso mide SUS avisos: la tabla es global y los casos comparten base.
  beforeEach(async () => {
    await Promise.all(notifyState.pending)
    notifyState.pending.length = 0
    await inMemoryDb.delete(schema.notifications)
  })

  it("punto 1: avisa el saldo que quedó fuera al cerrar la OC con recepción parcial", async () => {
    // Antes: el saldo se separaba en un ítem hermano `pending_purchase` —
    // correcto y trazable— pero en silencio; el solicitante veía su ítem en
    // `partially_received` sin ningún aviso de que su pedido se había partido.
    const { requestId, requestItemId, orderId, orderItemId, orderCode } = await makeOrder(10, "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: ACTOR_ID, stage: "faena",
      items: [{ purchaseOrderItemId: orderItemId, quantityReceived: 6 }],
    })
    await shortfallNotificationsForRequester()

    await closeOrder(orderId, ACTOR_ID, "Cierre con saldo pendiente")

    const notifications = await shortfallNotificationsForRequester()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.dedupeKey).toBe(`saldo-recortado:${requestItemId}:4`)
    expect(notifications[0]!.body).toContain("4 unidad")
    expect(notifications[0]!.body).toContain(orderCode)
    expect(notifications[0]!.entityHref).toBe(`/solicitudes/${requestId}`)
  })

  it("punto 2: avisa lo rechazado o dañado en la recepción, que no suma stock ni avanza el ítem", async () => {
    // Antes: el rechazo consumía el cupo de la etapa y el saldo quedaba muerto
    // (`REC-002`); el ítem de solicitud ni siquiera se movía, así que el
    // solicitante no tenía forma de enterarse.
    const { requestItemId, orderId, orderItemId } = await makeOrder(10, "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: ACTOR_ID, stage: "faena",
      items: [{ purchaseOrderItemId: orderItemId, quantityReceived: 6, quantityRejected: 3, quantityDamaged: 1 }],
    })

    const notifications = await shortfallNotificationsForRequester()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.dedupeKey).toBe(`saldo-recortado:${requestItemId}:4`)
    expect(notifications[0]!.body).toMatch(/rechazaron o llegaron dañadas/i)
    expect(notifications[0]!.body).toContain("4 unidad")
  })

  it("punto 3: avisa la merma detectada al cotejar la guía interna aunque el ítem llegue a 'received'", async () => {
    // Antes: la diferencia se documentaba con motivo, pero el stock del destino
    // ya se había cargado completo al despachar (`GDI-001`) y el solicitante
    // sólo recibía el aviso de "tu pedido llegó a faena".
    const { requestItemId, orderId, orderItemId } = await makeOrder(5, "via_oficina")
    const receiptId = await registerReceipt({
      purchaseOrderId: orderId, receivedBy: ACTOR_ID, stage: "office",
      items: [{ purchaseOrderItemId: orderItemId, quantityReceived: 5 }],
    })
    await shortfallNotificationsForRequester()

    const [guide] = await inMemoryDb.select().from(schema.dispatchGuides)
      .where(eq(schema.dispatchGuides.receiptId, receiptId))
    await dispatchDispatchGuide(guide!.id, { userId: ACTOR_ID })
    const detail = await getDispatchGuideDetail(guide!.id)
    await confirmDispatchGuideReceipt(guide!.id, {
      items: [{ guideItemId: detail!.guide.items[0]!.id, quantityReceived: 3, differenceReason: "Faltaron dos cascos en el traslado" }],
    }, { userId: ACTOR_ID })

    const notifications = await shortfallNotificationsForRequester()
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.dedupeKey).toBe(`saldo-recortado:${requestItemId}:2`)
    expect(notifications[0]!.body).toContain(guide!.code)
    expect(notifications[0]!.body).toContain("2 unidad")
  })

  it("un mismo recorte recorrido por dos puntos avisa una sola vez", async () => {
    // El caso real: se rechazan 4 unidades al recepcionar (punto 2) y después
    // se cierra la OC, que ve esas mismas 4 sin recibir (punto 1). Son dos
    // transacciones distintas; sin una llave estable por (ítem, faltante) el
    // solicitante recibía el mismo aviso dos veces.
    const { requestItemId, orderId, orderItemId } = await makeOrder(10, "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: ACTOR_ID, stage: "faena",
      items: [{ purchaseOrderItemId: orderItemId, quantityReceived: 6, quantityRejected: 4 }],
    })
    const afterReceipt = await shortfallNotificationsForRequester()
    expect(afterReceipt).toHaveLength(1)

    await closeOrder(orderId, ACTOR_ID, "Cierre tras rechazo parcial")
    const afterClose = await shortfallNotificationsForRequester()

    expect(afterClose).toHaveLength(1)
    expect(afterClose[0]!.id).toBe(afterReceipt[0]!.id)
    expect(afterClose[0]!.dedupeKey).toBe(`saldo-recortado:${requestItemId}:4`)
  })
})
