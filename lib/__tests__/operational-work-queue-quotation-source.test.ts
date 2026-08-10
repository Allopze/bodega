/**
 * UX-5: la etapa "seleccionar cotización ganadora" (repuestos/servicios) no
 * tenía ninguna fuente en la cola operacional — quedaba invisible para
 * /pendientes y su badge. Aislado en su propio PGlite: el fixture compartido
 * de operational-assignments.test.ts ya tiene asserts sobre totales globales
 * de la cola, y agregar filas ahí los correría.
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

import { getOperationalWorkQueue, getOperationalWorkCount } from "@/lib/services/operational-work-queue"

describe("operational work queue — cotización ganadora (repuestos/servicios)", () => {
  const now = "2026-08-08T12:00:00.000Z"
  const worksiteId = "ws-owq-test"

  function makeSession(permissions: string[]): Session {
    return {
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        id: "user-owq-test", name: "Test", email: "owq-test@chome.cl",
        roles: [], permissions, worksiteIds: [worksiteId], primaryWorksiteId: worksiteId,
        avatarColor: null, isActive: true,
      },
    } as Session
  }

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena OWQ Test", code: "OWQ-TEST", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: "user-owq-test", name: "Test", email: "owq-test@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      {
        id: "req-owq-repuesto", code: "SOL-OWQ-REP", worksiteId, requesterId: "user-owq-test",
        requestType: "repuestos", urgency: "normal", status: "submitted", createdAt: now, updatedAt: now,
      },
      {
        id: "req-owq-servicio", code: "SOL-OWQ-SERV", worksiteId, requesterId: "user-owq-test",
        requestType: "servicios", urgency: "normal", status: "in_review", createdAt: now, updatedAt: now,
      },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("ofrece la solicitud de repuestos a quien tiene repuestos:approve", async () => {
    const result = await getOperationalWorkQueue(makeSession(["repuestos:approve"]), { module: "aprobaciones" })
    const item = result.items.find((i) => i.sourceId === "req-owq-repuesto")
    expect(item).toBeDefined()
    expect(item!.href).toBe("/solicitudes/req-owq-repuesto")
    expect(item!.ctaLabel).toBe("Seleccionar cotización ganadora")
  })

  it("ofrece la solicitud de servicios a quien tiene servicios:approve", async () => {
    const result = await getOperationalWorkQueue(makeSession(["servicios:approve"]), { module: "aprobaciones" })
    expect(result.items.some((i) => i.sourceId === "req-owq-servicio")).toBe(true)
  })

  it("no ofrece la solicitud de repuestos a quien no tiene el permiso", async () => {
    const result = await getOperationalWorkQueue(makeSession(["approvals:approve"]), { module: "aprobaciones" })
    expect(result.items.some((i) => i.sourceId === "req-owq-repuesto")).toBe(false)
    expect(result.items.some((i) => i.sourceId === "req-owq-servicio")).toBe(false)
  })

  // El badge del rail es un espejo de estas mismas fuentes. Le faltaba la rama
  // de cotizaciones: quien sólo tenía ese trabajo veía 0 mientras /pendientes
  // listaba la tarea.
  it("el contador del badge cuenta lo mismo que la cola", async () => {
    const session = makeSession(["repuestos:approve", "servicios:approve"])
    const queue = await getOperationalWorkQueue(session, { module: "aprobaciones" })
    const count = await getOperationalWorkCount(session)
    expect(queue.items.length).toBe(2)
    expect(count).toBe(2)
  })

  it("el contador respeta el permiso por tipo", async () => {
    expect(await getOperationalWorkCount(makeSession(["repuestos:approve"]))).toBe(1)
    expect(await getOperationalWorkCount(makeSession(["approvals:approve"]))).toBe(0)
  })
})
