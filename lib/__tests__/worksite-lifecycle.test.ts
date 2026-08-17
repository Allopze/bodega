import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const now = "2026-08-14T12:00:00.000Z"

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionCapaTransitions)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.inventoryMovements)
  // Antes de `worksites`, que la referencia por FK. Sin esta línea un
  // trabajador sembrado por un test bloquea el cierre de faena de los
  // siguientes, que es justo lo que la guarda nueva impide.
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksiteStock)
  await inMemoryDb.delete(schema.products)
  await inMemoryDb.delete(schema.productCategories)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "actor-1", name: "Admin", email: "admin@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.productCategories).values({ id: "cat-life", name: "General", slug: "general" })
  await inMemoryDb.insert(schema.products).values({
    id: "prod-life", sku: "SKU-LIFE", name: "Guante", categoryId: "cat-life", unitOfMeasure: "par",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-life", name: "Faena a cerrar", code: "LIFE", isActive: true },
    // `resolveOfficeWorksite` la reconoce por nombre cuando no hay ajuste.
    { id: "ws-oficina", name: "Oficina Central", code: "OFI", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: "prog-life", year: 2026, version: 1, title: "Programa", status: "active",
    elaboratedByName: "Test", elaboratedByTitle: "Prevención", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
    id: "pw-life", programId: "prog-life", worksiteId: "ws-life", isActive: true, addedAt: now,
  })
  await inMemoryDb.insert(schema.preventionCapaActions).values([
    {
      id: "capa-life-open", code: "CAPA-2026-9101", sourceType: "manual", sourceId: "x",
      worksiteId: "ws-life", finding: "Hallazgo abierto", actionDescription: "Corregir",
      priority: "medium", targetDate: "2026-09-01", status: "in_progress",
      createdByUserId: "actor-1", createdAt: now, updatedAt: now,
    },
    {
      id: "capa-life-verified", code: "CAPA-2026-9102", sourceType: "manual", sourceId: "y",
      worksiteId: "ws-life", finding: "Hallazgo resuelto", actionDescription: "Conservar",
      priority: "low", targetDate: "2026-07-01", status: "verified",
      createdByUserId: "actor-1", createdAt: now, updatedAt: now,
    },
  ])
})

describe("worksite lifecycle", () => {
  it("cierra membresía, CAPA y faena en una sola operación auditada", async () => {
    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    const result = await setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      actorEmail: "admin@example.test",
      scope: { mode: "all", ids: [] },
    })

    expect(result).toMatchObject({ programsDropped: 1, capaCancelled: 1 })
    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    const [membership] = await inMemoryDb.select().from(schema.pdtpProgramWorksites)
      .where(eq(schema.pdtpProgramWorksites.worksiteId, "ws-life"))
    const capas = await inMemoryDb.select().from(schema.preventionCapaActions)
    const transitions = await inMemoryDb.select().from(schema.preventionCapaTransitions)
    const audits = await inMemoryDb.select().from(schema.auditLog)

    expect(worksite?.isActive).toBe(false)
    expect(membership?.isActive).toBe(false)
    expect(capas.find((row) => row.id === "capa-life-open")).toMatchObject({
      status: "cancelled", cancelledByUserId: "actor-1", version: 2,
    })
    expect(capas.find((row) => row.id === "capa-life-verified")?.status).toBe("verified")
    expect(transitions).toHaveLength(1)
    expect(audits.some((row) => row.entityId === "ws-life")).toBe(true)
  })

  it("revierte todo si una escritura del cierre falla", async () => {
    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-inexistente",
      scope: { mode: "all", ids: [] },
    })).rejects.toThrow()

    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    const [membership] = await inMemoryDb.select().from(schema.pdtpProgramWorksites)
      .where(eq(schema.pdtpProgramWorksites.worksiteId, "ws-life"))
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, "capa-life-open"))

    expect(worksite?.isActive).toBe(true)
    expect(membership?.isActive).toBe(true)
    expect(capa?.status).toBe("in_progress")
  })

  it("rechaza el cierre si la faena todavía tiene existencias, sin cancelar nada", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-life", worksiteId: "ws-life", productId: "prod-life", quantity: 7,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
    })).rejects.toThrow(/existencias/i)

    // El saldo atrapado sería irrecuperable, así que el cierre no puede dejar a
    // medias las cancelaciones que ya hacía.
    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    const [membership] = await inMemoryDb.select().from(schema.pdtpProgramWorksites)
      .where(eq(schema.pdtpProgramWorksites.worksiteId, "ws-life"))
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, "capa-life-open"))

    expect(worksite?.isActive).toBe(true)
    expect(membership?.isActive).toBe(true)
    expect(capa?.status).toBe("in_progress")
  })

  it("rechaza el cierre si la faena todavía tiene dotación activa, sin cancelar nada", async () => {
    await inMemoryDb.insert(schema.workers).values({
      id: "wk-life", firstName: "Ana", lastName: "Pérez", rut: "11.111.111-1",
      worksiteId: "ws-life", isActive: true,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
    })).rejects.toThrow(/trabajador activo|trabajadores activos/i)

    // Así llegó producción a tener 146 trabajadores colgando de faenas
    // cerradas: seguían activos, pero su faena ya no aparecía en ningún
    // selector, así que no se les podía entregar nada.
    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, "capa-life-open"))
    expect(worksite?.isActive).toBe(true)
    expect(capa?.status).toBe("in_progress")
  })

  it("un trabajador dado de baja no bloquea el cierre de su faena", async () => {
    await inMemoryDb.insert(schema.workers).values({
      id: "wk-life-baja", firstName: "Luis", lastName: "Soto", rut: "22.222.222-2",
      worksiteId: "ws-life", isActive: false,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
    })).resolves.toMatchObject({ programsDropped: 1 })
  })

  it("una fila de stock en cero es historial y no bloquea el cierre", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-life-zero", worksiteId: "ws-life", productId: "prod-life", quantity: 0,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
    })).resolves.toMatchObject({ programsDropped: 1 })
  })

  it("devuelve el saldo a Oficina y cierra la faena en la misma operación", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-life-devolver", worksiteId: "ws-life", productId: "prod-life", quantity: 4,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    const result = await setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
      returnStockToOffice: true,
    })

    expect(result.stockReturned).toMatchObject({ products: 1, units: 4, officeName: "Oficina Central" })

    const stock = await inMemoryDb.select().from(schema.worksiteStock)
    expect(stock.find((row) => row.worksiteId === "ws-life")?.quantity).toBe(0)
    expect(stock.find((row) => row.worksiteId === "ws-oficina")?.quantity).toBe(4)

    // Las dos patas quedan en el kardex: sin ellas la devolución sería un
    // ajuste sin contraparte y Oficina cuadraría por casualidad.
    const movements = await inMemoryDb.select().from(schema.inventoryMovements)
    expect(movements.map((row) => row.type).sort()).toEqual(["egreso_traslado", "ingreso_traslado"])

    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    expect(worksite?.isActive).toBe(false)
  })

  it("no mueve nada si el cierre falla después de devolver el saldo", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-life-rollback", worksiteId: "ws-life", productId: "prod-life", quantity: 4,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-inexistente", // revienta el audit log al final
      scope: { mode: "all", ids: [] },
      returnStockToOffice: true,
    })).rejects.toThrow()

    const stock = await inMemoryDb.select().from(schema.worksiteStock)
    expect(stock.find((row) => row.worksiteId === "ws-life")?.quantity).toBe(4)
    expect(stock.find((row) => row.worksiteId === "ws-oficina")).toBeUndefined()
    await expect(inMemoryDb.select().from(schema.inventoryMovements)).resolves.toHaveLength(0)
  })

  it("no devuelve el saldo si no se pidió, y el cierre sigue bloqueado", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-life-sin-devolucion", worksiteId: "ws-life", productId: "prod-life", quantity: 4,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: false,
      reason: "Término definitivo del contrato principal.",
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
    })).rejects.toThrow(/existencias/i)

    await expect(inMemoryDb.select().from(schema.inventoryMovements)).resolves.toHaveLength(0)
  })

  it("reactivar una faena con saldo atrapado no se bloquea a sí mismo", async () => {
    await inMemoryDb.update(schema.worksites).set({ isActive: false }).where(eq(schema.worksites.id, "ws-life"))
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-life-huerfano", worksiteId: "ws-life", productId: "prod-life", quantity: 3,
    })

    const { setWorksiteActive } = await import("@/lib/services/worksite-lifecycle")
    await expect(setWorksiteActive({
      worksiteId: "ws-life",
      activate: true,
      actorUserId: "actor-1",
      scope: { mode: "all", ids: [] },
    })).resolves.toBeTruthy()

    const [worksite] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-life"))
    expect(worksite?.isActive).toBe(true)
  })
})
