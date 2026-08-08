/**
 * Cancelación unificada de solicitudes (F1-1/F1-2, LOG-2/LOG-3/DAT-2/DAT-6).
 *
 * `cancelRequest` es hoy la única implementación — la usan tanto la action
 * genérica de EPP/otro (`solicitudes/actions-module/cancel.ts`) como el
 * factory de repuestos/servicios. Corre contra PGlite real porque lockea
 * (FOR UPDATE) el padre y los ítems antes de decidir; un mock superficial de
 * `db.transaction` no puede ejercitar eso.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { cancelRequest } from "@/lib/requests/request-service-module/cancel-request"

describe("cancelRequest — DB integration", () => {
  const now = new Date().toISOString()
  const userId = "user-cancel-test"
  const worksiteId = "ws-cancel-test"

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Test User", email: "cancel-test@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Cancel Test", code: "F-CANCEL",
      isActive: true, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  async function makeRequest(opts: {
    id: string; status: string; requestType?: string
    items?: Array<{ id: string; status: string }>
  }) {
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: opts.id, code: `SOL-${opts.id}`, worksiteId, requesterId: userId,
      requestType: opts.requestType ?? "epp", urgency: "normal", status: opts.status,
      createdAt: now, updatedAt: now,
    })
    for (const item of opts.items ?? []) {
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: item.id, requestId: opts.id, productNameFree: "Ítem test",
        quantity: 1, unitOfMeasure: "unidad", status: item.status,
        createdAt: now, updatedAt: now,
      })
    }
  }

  it("cancela un draft sin motivo", async () => {
    await makeRequest({ id: "req-draft", status: "draft" })
    await cancelRequest("req-draft", userId, "")
    const [request] = await inMemoryDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, "req-draft"))
    expect(request!.status).toBe("cancelled")
    expect(request!.closedAt).toBeTruthy()
  })

  it("exige motivo para una solicitud enviada", async () => {
    await makeRequest({ id: "req-submitted-noreason", status: "submitted" })
    await expect(cancelRequest("req-submitted-noreason", userId, "")).rejects.toThrow("El motivo de cancelación es obligatorio")
  })

  it("rechaza un estado no cancelable", async () => {
    await makeRequest({ id: "req-approved", status: "approved" })
    await expect(cancelRequest("req-approved", userId, "motivo")).rejects.toThrow("No se puede cancelar una solicitud en estado 'approved'")
  })

  it("rechaza si ya tiene ítems en compra, recepción o entrega", async () => {
    await makeRequest({
      id: "req-locked", status: "submitted",
      items: [{ id: "item-locked", status: "in_purchase_order" }],
    })
    await expect(cancelRequest("req-locked", userId, "motivo"))
      .rejects.toThrow("No se puede cancelar: la solicitud ya tiene ítems en compra, recepción o entrega")
  })

  it("rechaza los ítems abiertos y fija closedAt al cancelar (cierra LOG-3: la ruta de repuestos/servicios ya no deja ítems huérfanos)", async () => {
    await makeRequest({
      id: "req-with-items", status: "submitted",
      items: [
        { id: "item-draft", status: "draft" },
        { id: "item-requested", status: "requested" },
        { id: "item-approved", status: "approved" },
      ],
    })
    const { rejectedItemIds } = await cancelRequest("req-with-items", userId, "Ya no se necesita")

    expect(new Set(rejectedItemIds)).toEqual(new Set(["item-draft", "item-requested", "item-approved"]))

    const [request] = await inMemoryDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, "req-with-items"))
    expect(request!.status).toBe("cancelled")
    expect(request!.closedAt).toBeTruthy()

    const items = await inMemoryDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, "req-with-items"))
    expect(items.every((i) => i.status === "rejected")).toBe(true)
  })

  it("filtra por requestType cuando lo pasa el factory de repuestos/servicios", async () => {
    await makeRequest({ id: "req-repuestos", status: "draft", requestType: "repuestos" })
    await expect(cancelRequest("req-repuestos", userId, "", { requestType: "servicios" }))
      .rejects.toThrow("Solicitud no encontrada")
    // El tipo correcto sí funciona.
    await cancelRequest("req-repuestos", userId, "", { requestType: "repuestos" })
    const [request] = await inMemoryDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, "req-repuestos"))
    expect(request!.status).toBe("cancelled")
  })

  it("libera la reserva de reposición EPP del ítem rechazado (LOG-1/DAT-7)", async () => {
    await inMemoryDb.insert(schema.eppTypes).values({
      id: "epp-type-cancel-test", code: "casco-cancel", label: "Casco", sortOrder: 0, createdAt: now,
    })
    await inMemoryDb.insert(schema.workers).values({
      id: "worker-cancel-test", firstName: "Ana", lastName: "Test", worksiteId,
      isActive: true, createdAt: now,
    })
    await makeRequest({
      id: "req-epp-link", status: "submitted",
      items: [{ id: "item-epp-link", status: "requested" }],
    })
    await inMemoryDb.insert(schema.eppReplenishmentLinks).values({
      id: "link-cancel-test", worksiteId, workerId: "worker-cancel-test",
      eppTypeId: "epp-type-cancel-test", requirementId: "req-cancel-test",
      gapVersion: "missing:none", requestItemId: "item-epp-link",
      resolvedAt: null, createdAt: now,
    })

    await cancelRequest("req-epp-link", userId, "Ya no se necesita")

    const [link] = await inMemoryDb.select().from(schema.eppReplenishmentLinks).where(eq(schema.eppReplenishmentLinks.id, "link-cancel-test"))
    expect(link!.resolvedAt).toBeTruthy()
  })
})
