/**
 * Edición de un ítem pendiente desde la ficha de la solicitud.
 *
 * La ficha (`app/(app)/solicitudes/[id]/page.tsx`) lee los ítems con
 * `db.query.purchaseRequests.findFirst({ with: { items } })`. Esa consulta
 * relacional arma los ítems con `json_build_array`, así que Postgres serializa
 * `updated_at` como JSON (`2026-11-28T17:29:20.053+00:00`), mientras que un
 * `select` directo lo devuelve como texto (`2026-11-28 17:29:20.053+00`). El
 * servicio comparaba ambos como strings: nunca coincidían y «Guardar cambios»
 * fallaba siempre con «El ítem cambió desde que abriste la edición».
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

import { updatePendingRequestItem } from "@/lib/services/request-item-edit"

describe("updatePendingRequestItem — token de la ficha", () => {
  const now = new Date().toISOString()
  const userId = "user-item-edit"
  const worksiteId = "ws-item-edit"

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Solicitante", email: "item-edit@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Edit", code: "F-EDIT",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-edit", code: "SOL-EDIT", worksiteId, requesterId: userId,
      requestType: "otro", urgency: "normal", status: "submitted",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-edit", requestId: "req-edit", productNameFree: "Cinta aisladora",
      quantity: 2, unitOfMeasure: "unidad", status: "requested",
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  async function tokenFromRequestPage(itemId: string) {
    // Misma consulta que la ficha de la solicitud.
    const request = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, "req-edit"),
      with: { items: { with: { attributes: true } } },
    })
    return request!.items.find((item) => item.id === itemId)!.updatedAt
  }

  const edit = (expectedUpdatedAt: string, quantity: number) => updatePendingRequestItem({
    itemId: "item-edit",
    expectedUpdatedAt,
    actorUserId: userId,
    item: {
      productId: null, productNameFree: "Cinta aisladora", quantity,
      unitOfMeasure: "unidad", urgency: "normal", sortOrder: 0, attributes: [],
    },
  })

  it("guarda con el updatedAt que entrega la ficha, y otra vez con el que devuelve", async () => {
    const first = await edit(await tokenFromRequestPage("item-edit"), 5)
    expect(first.quantity).toBe(5)

    // Segunda edición sin recargar: el cliente reutiliza el token devuelto.
    const second = await edit(first.updatedAt, 6)
    expect(second.quantity).toBe(6)

    // Y tras recargar la ficha.
    const third = await edit(await tokenFromRequestPage("item-edit"), 7)
    expect(third.quantity).toBe(7)

    const [row] = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.id, "item-edit"))
    expect(row!.quantity).toBe(7)
  })

  it("sigue rechazando un token viejo", async () => {
    const stale = await tokenFromRequestPage("item-edit")
    await edit(stale, 8)
    await expect(edit(stale, 9)).rejects.toThrow(/cambió/)
  })
})
