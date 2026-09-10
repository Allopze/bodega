/**
 * La cola tenía dos filas que el usuario no podía leer:
 *
 *  - Una solicitud se titulaba con su propio código, y la fila mostraba
 *    "SOL-0030" arriba y "SOL-0030 · 6 ítems" abajo — el código dos veces y
 *    nada sobre lo que se pedía.
 *  - Dos ítems del mismo producto en la misma solicitud (dos tallas del mismo
 *    guante) producían dos filas de texto idéntico, indistinguibles entre sí.
 *
 * Estos casos fijan la identidad visible de ambas filas.
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
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { getOperationalWorkQueue } from "@/lib/services/operational-work-queue"

describe("operational work queue — identidad de la fila", () => {
  const now = "2026-08-08T12:00:00.000Z"
  const worksiteId = "ws-row-identity"

  function makeSession(permissions: string[]): Session {
    return {
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        id: "user-row-identity", name: "Test", email: "row-identity@chome.cl",
        roles: [], permissions, worksiteIds: [worksiteId], primaryWorksiteId: worksiteId,
        avatarColor: null, isActive: true,
      },
    } as Session
  }

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Identidad", code: "ROW-ID", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: "user-row-identity", name: "Test", email: "row-identity@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-epp", name: "EPP", slug: "epp-row-identity", isEpp: true,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-guante", name: "Guante Activex Nitrilo Heavy Duty", sku: "GUA-001",
      categoryId: "cat-epp", unitOfMeasure: "par", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      {
        id: "req-varios", code: "SOL-VARIOS", worksiteId, requesterId: "user-row-identity",
        requestType: "epp", urgency: "normal", status: "in_purchasing", createdAt: now, updatedAt: now,
      },
      {
        id: "req-unico", code: "SOL-UNICO", worksiteId, requesterId: "user-row-identity",
        requestType: "epp", urgency: "normal", status: "in_purchasing", createdAt: now, updatedAt: now,
      },
    ])
    // Dos ítems del MISMO producto en la misma solicitud: el caso que producía
    // dos filas de texto idéntico en la cola de compras.
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      {
        id: "item-guante-l", requestId: "req-varios", productId: "prod-guante",
        quantity: 12, unitOfMeasure: "par", status: "approved", sortOrder: 0, createdAt: now, updatedAt: now,
      },
      {
        id: "item-guante-xl", requestId: "req-varios", productId: "prod-guante",
        quantity: 2.5, unitOfMeasure: "par", status: "approved", sortOrder: 1, createdAt: now, updatedAt: now,
      },
      {
        id: "item-buzo", requestId: "req-varios", productNameFree: "Buzo Tyvek Dupont",
        quantity: 4, unitOfMeasure: "unidad", status: "approved", sortOrder: 2, createdAt: now, updatedAt: now,
      },
      {
        id: "item-solo", requestId: "req-unico", productId: "prod-guante",
        quantity: 1, unitOfMeasure: "par", status: "approved", sortOrder: 0, createdAt: now, updatedAt: now,
      },
      // El escenario que motivó cambiar el orden por defecto: una tarea normal
      // muy atrasada contra una alta que todavía no vence.
      {
        id: "item-atrasado", requestId: "req-varios", productNameFree: "Casco atrasado",
        quantity: 1, unitOfMeasure: "unidad", status: "approved", urgency: "normal",
        requiredDate: "2026-01-15", sortOrder: 3, createdAt: now, updatedAt: now,
      },
      {
        id: "item-urgente", requestId: "req-varios", productNameFree: "Arnés al día",
        quantity: 1, unitOfMeasure: "unidad", status: "approved", urgency: "high",
        requiredDate: "2099-01-15", sortOrder: 4, createdAt: now, updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.requestItemAttributes).values([
      { id: "attr-l", requestItemId: "item-guante-l", attributeName: "Talla", value: "L" },
      { id: "attr-xl", requestItemId: "item-guante-xl", attributeName: "Talla", value: "XL" },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("la solicitud se titula con su contenido y el resumen de lo que falta", async () => {
    const result = await getOperationalWorkQueue(makeSession(["requests:view_all"]), { module: "solicitudes" })
    const varios = result.items.find((item) => item.sourceId === "req-varios")
    expect(varios?.title).toBe("Revisar Guante Activex Nitrilo Heavy Duty y 4 ítems más")
    // El código vive en `code`; el subtítulo ya no lo repite.
    expect(varios?.code).toBe("SOL-VARIOS")
    expect(varios?.subtitle).toBe("")
  })

  it("una solicitud de un solo ítem no dice 'y 0 ítems más'", async () => {
    const result = await getOperationalWorkQueue(makeSession(["requests:view_all"]), { module: "solicitudes" })
    const unico = result.items.find((item) => item.sourceId === "req-unico")
    expect(unico?.title).toBe("Revisar Guante Activex Nitrilo Heavy Duty")
  })

  it("dos ítems del mismo producto se distinguen por cantidad y atributos", async () => {
    const result = await getOperationalWorkQueue(makeSession(["purchasing:create_order"]), { module: "compras" })
    const talla = (id: string) => result.items.find((item) => item.sourceId === id)
    expect(talla("item-guante-l")?.title).toBe("Comprar Guante Activex Nitrilo Heavy Duty")
    expect(talla("item-guante-l")?.subtitle).toBe("12 par · Talla L")
    expect(talla("item-guante-xl")?.subtitle).toBe("2.5 par · Talla XL")
    // Sin atributos el subtítulo se queda sólo con la cantidad, sin separador
    // colgando.
    expect(talla("item-buzo")?.subtitle).toBe("4 unidad")
  })

  // Ordenando por prioridad, lo más atrasado quedaba enterrado bajo tareas que
  // aún no vencían sólo porque su etiqueta decía "Alta": la columna de
  // vencimiento gritaba una cosa y el orden de la lista decía otra.
  it("sin criterio explícito, lo más atrasado va primero aunque su prioridad sea normal", async () => {
    const result = await getOperationalWorkQueue(makeSession(["purchasing:create_order"]), { module: "compras" })
    const ids = result.items.map((item) => item.sourceId)
    expect(ids[0]).toBe("item-atrasado")
    expect(ids.indexOf("item-atrasado")).toBeLessThan(ids.indexOf("item-urgente"))
  })

  it("pedir orden por prioridad explícitamente sigue funcionando", async () => {
    const result = await getOperationalWorkQueue(makeSession(["purchasing:create_order"]), { module: "compras", sort: "priority" })
    const ids = result.items.map((item) => item.sourceId)
    expect(ids.indexOf("item-urgente")).toBeLessThan(ids.indexOf("item-atrasado"))
  })

  it("el buscador encuentra un ítem por su atributo, no sólo por el producto", async () => {
    const result = await getOperationalWorkQueue(makeSession(["purchasing:create_order"]), { module: "compras", q: "Talla XL" })
    expect(result.items.map((item) => item.sourceId)).toEqual(["item-guante-xl"])
  })
})
