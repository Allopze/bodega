/**
 * OC-2026-0065 (2026-11-20): la cola ofrecía «Recibir OC en faena» con destino
 * `/recepcion/nueva` a toda OC vía oficina pendiente de faena. Si la OC tiene una
 * guía de despacho viva, ese formulario no puede guardar nunca —`registerReceipt`
 * exige cotejar la guía— y el botón «Registrar recepción en faena» quedaba sin
 * salida. Con guía, la tarea lleva a la guía y la ve quien puede hacer lo que la
 * guía pide. Aislado en su propio PGlite por la misma razón que la fuente de
 * cotizaciones: otros fixtures afirman totales globales de la cola.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import {
  getOperationalDetailWorkItem,
  getOperationalWorkCount,
  getOperationalWorkQueue,
} from "@/lib/services/operational-work-queue"

const now = "2026-11-20T12:00:00.000Z"
const worksiteId = "ws-gdi-queue"
const officeId = "ws-gdi-office"
const userId = "user-gdi-queue"

function makeSession(permissions: string[]): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: userId, name: "Test", email: "gdi-queue@chome.cl",
      roles: [], permissions, worksiteIds: [worksiteId], primaryWorksiteId: worksiteId,
      avatarColor: null, isActive: true,
    },
  } as Session
}

// Una OC por caso. `guides` son los estados de sus guías, en orden de creación.
const ORDERS = [
  { id: "oc-sin-guia", status: "office_received", guides: [] },
  { id: "oc-despachada", status: "office_received", guides: ["dispatched"] },
  { id: "oc-parcial", status: "partially_received", guides: ["partially_received"] },
  { id: "oc-borrador", status: "office_received", guides: ["draft"] },
  { id: "oc-anulada", status: "office_received", guides: ["cancelled"] },
  // Un segundo despacho en borrador mientras el primero espera confirmación:
  // son dos tareas de dos personas distintas.
  { id: "oc-dos-guias", status: "partially_received", guides: ["partially_received", "draft"] },
] as const

const guideId = (orderId: string, index: number) => `gdi-${orderId}-${index}`

const FAENA_RECEIVER = ["receiving:register_faena", "warehouse:receive_guide"]
const OFFICE_DISPATCHER = ["receiving:register_faena", "warehouse:dispatch_guide"]

async function recepciones(permissions: string[]) {
  const queue = await getOperationalWorkQueue(makeSession(permissions), { module: "recepciones" })
  return queue.items.map((item) => ({ order: item.sourceId, action: item.actionKey, href: item.href, cta: item.ctaLabel }))
}

describe("cola operacional — recepción en faena de una OC con guía de despacho", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena GDI", code: "GDI-Q", isActive: true, createdAt: now, updatedAt: now },
      { id: officeId, name: "Oficina GDI", code: "GDI-OF", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Test", email: "gdi-queue@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({ id: "sup-gdi-queue", name: "Proveedor GDI" })
    await inMemoryDb.insert(schema.purchaseOrders).values(ORDERS.map((order, index) => ({
      id: order.id, code: `OC-2026-9${String(index).padStart(3, "0")}`, worksiteId, supplierId: "sup-gdi-queue",
      createdBy: userId, status: order.status, deliveryMode: "via_oficina", createdAt: now, updatedAt: now,
    })))
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: "oc-directo", code: "OC-2026-9999", worksiteId, supplierId: "sup-gdi-queue",
      createdBy: userId, status: "sent", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
    })
    let sequence = 0
    for (const order of ORDERS) {
      for (const [index, status] of order.guides.entries()) {
        sequence += 1
        // Los sellos que exigen los CHECK de cada estado.
        const dispatched = status !== "draft" && status !== "cancelled"
        const received = status === "partially_received"
        await inMemoryDb.insert(schema.dispatchGuides).values({
          id: guideId(order.id, index), code: `GDI-9${String(sequence).padStart(5, "0")}`, status,
          originWorksiteId: officeId, destinationWorksiteId: worksiteId, purchaseOrderId: order.id,
          issuedBy: userId, issuedAt: now,
          ...(dispatched ? { dispatchedAt: now, dispatchedBy: userId } : {}),
          ...(received ? { receivedAt: now, receivedBy: userId } : {}),
          ...(status === "cancelled" ? { cancelledAt: now, cancelledBy: userId, cancellationReason: "Emitida por error en la prueba" } : {}),
          createdAt: `2026-11-20T12:00:0${sequence}.000Z`, updatedAt: now,
        })
      }
    }
  })

  afterAll(async () => { await pg.close() })

  it("sin guía viva la tarea sigue yendo al formulario de recepción", async () => {
    const rows = await recepciones(FAENA_RECEIVER)
    for (const order of ["oc-sin-guia", "oc-anulada", "oc-directo"]) {
      expect(rows.filter((row) => row.order === order)).toEqual([{
        order, action: "receive_worksite", href: `/recepcion/nueva?oc=${order}`, cta: "Registrar recepción",
      }])
    }
  })

  it("con la guía despachada o con llegada parcial, lleva a confirmar la guía", async () => {
    const rows = await recepciones(FAENA_RECEIVER)
    expect(rows.filter((row) => row.order === "oc-despachada")).toEqual([{
      order: "oc-despachada", action: "receive_worksite", href: `/bodega/guias/${guideId("oc-despachada", 0)}`, cta: "Confirmar llegada a faena",
    }])
    expect(rows.filter((row) => row.order === "oc-parcial")).toEqual([{
      order: "oc-parcial", action: "receive_worksite", href: `/bodega/guias/${guideId("oc-parcial", 0)}`, cta: "Confirmar llegada a faena",
    }])
  })

  it("nunca manda al formulario una OC con guía viva", async () => {
    const rows = await recepciones([...FAENA_RECEIVER, "warehouse:dispatch_guide"])
    const toForm = rows.filter((row) => row.href.startsWith("/recepcion/nueva")).map((row) => row.order).sort()
    expect(toForm).toEqual(["oc-anulada", "oc-directo", "oc-sin-guia"])
  })

  it("quien recibe en faena sin poder confirmar guías no recibe una tarea que no puede cerrar", async () => {
    const rows = await recepciones(["receiving:register_faena"])
    expect(rows.map((row) => row.order).sort()).toEqual(["oc-anulada", "oc-directo", "oc-sin-guia"])
  })

  it("una guía en borrador es tarea de quien despacha, no de la faena", async () => {
    const receiver = await recepciones(FAENA_RECEIVER)
    expect(receiver.some((row) => row.order === "oc-borrador")).toBe(false)

    const dispatcher = await recepciones(OFFICE_DISPATCHER)
    expect(dispatcher.filter((row) => row.order === "oc-borrador")).toEqual([{
      order: "oc-borrador", action: "dispatch_guide", href: `/bodega/guias/${guideId("oc-borrador", 0)}`, cta: "Completar despacho",
    }])
  })

  it("con una guía por confirmar y otra en borrador, cada tarea va a su guía", async () => {
    const rows = await recepciones([...FAENA_RECEIVER, "warehouse:dispatch_guide"])
    expect(rows.filter((row) => row.order === "oc-dos-guias").sort((a, b) => a.action.localeCompare(b.action))).toEqual([
      { order: "oc-dos-guias", action: "dispatch_guide", href: `/bodega/guias/${guideId("oc-dos-guias", 1)}`, cta: "Completar despacho" },
      { order: "oc-dos-guias", action: "receive_worksite", href: `/bodega/guias/${guideId("oc-dos-guias", 0)}`, cta: "Confirmar llegada a faena" },
    ])
  })

  it("el detalle de la OC proyecta la misma tarea que la cola", async () => {
    const receiver = makeSession(FAENA_RECEIVER)
    await expect(getOperationalDetailWorkItem(receiver, { sourceType: "purchase_order", sourceId: "oc-parcial" }))
      .resolves.toMatchObject({ actionKey: "receive_worksite", href: `/bodega/guias/${guideId("oc-parcial", 0)}`, ctaLabel: "Confirmar llegada a faena" })
    await expect(getOperationalDetailWorkItem(receiver, { sourceType: "purchase_order", sourceId: "oc-sin-guia" }))
      .resolves.toMatchObject({ actionKey: "receive_worksite", href: "/recepcion/nueva?oc=oc-sin-guia" })
    await expect(getOperationalDetailWorkItem(receiver, { sourceType: "purchase_order", sourceId: "oc-borrador" }))
      .resolves.toBeNull()
    await expect(getOperationalDetailWorkItem(makeSession(OFFICE_DISPATCHER), { sourceType: "purchase_order", sourceId: "oc-borrador" }))
      .resolves.toMatchObject({ actionKey: "dispatch_guide", href: `/bodega/guias/${guideId("oc-borrador", 0)}` })
  })

  it("el badge cuenta lo mismo que la cola", async () => {
    for (const permissions of [FAENA_RECEIVER, OFFICE_DISPATCHER, ["receiving:register_faena"]]) {
      const queue = await getOperationalWorkQueue(makeSession(permissions))
      await expect(getOperationalWorkCount(makeSession(permissions))).resolves.toBe(queue.total)
    }
  })
})
