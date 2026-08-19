import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

const mockAuthFn = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const { setMinStockBulkAction } = await import("@/app/(app)/bodega/actions")

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
const now = new Date().toISOString()

function session(worksiteIds: string[] = ["ws-min"]): Session {
  return {
    user: {
      id: "user-min", name: "Bodeguero", email: "min@test.local",
      permissions: ["warehouse:register_movement"], roles: ["bodeguero"],
      worksiteIds, isGlobal: false,
    },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Session
}

/** Arreglos paralelos, tal como los envía el formulario de N filas. */
function form(worksiteId: string, rows: Array<[stockId: string, value: string]>): FormData {
  const data = new FormData()
  data.set("worksiteId", worksiteId)
  for (const [stockId, value] of rows) {
    data.append("minStockId", stockId)
    data.append("minStockValue", value)
  }
  return data
}

async function minStockOf(id: string): Promise<number | undefined> {
  const [row] = await inMemoryDb.select().from(schema.worksiteStock).where(eq(schema.worksiteStock.id, id))
  return row?.minStock
}

describe("setMinStockBulkAction", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.users).values({
      id: "user-min", name: "Bodeguero", email: "min@test.local",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-min", name: "Faena Min", code: "F-MIN", isActive: true, createdAt: now, updatedAt: now },
      { id: "ws-min-other", name: "Faena Ajena", code: "F-MIN-AJ", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-min", name: "Cat Min", slug: "cat-min", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values([
      { id: "prod-min-a", sku: "MIN-A", name: "Producto A", categoryId: "cat-min", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
      { id: "prod-min-b", sku: "MIN-B", name: "Producto B", categoryId: "cat-min", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
    ])
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockAuthFn.mockResolvedValue(session())
    // El audit_log es acumulativo en la misma instancia PGlite: sin limpiarlo,
    // la prueba de auditoría contaría también las tandas de las pruebas previas.
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.worksiteStock)
    await inMemoryDb.insert(schema.worksiteStock).values([
      { id: "stock-min-a", worksiteId: "ws-min", productId: "prod-min-a", quantity: 10, minStock: 0, updatedAt: now },
      { id: "stock-min-b", worksiteId: "ws-min", productId: "prod-min-b", quantity: 4, minStock: 7, updatedAt: now },
      { id: "stock-min-ajena", worksiteId: "ws-min-other", productId: "prod-min-a", quantity: 1, minStock: 0, updatedAt: now },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("guarda sólo las filas efectivamente tecleadas", async () => {
    const result = await setMinStockBulkAction({ ok: false }, form("ws-min", [
      ["stock-min-a", "5"],
      ["stock-min-b", ""],
    ]))

    expect(result.ok).toBe(true)
    expect(await minStockOf("stock-min-a")).toBe(5)
    // La celda en blanco significa "no tocar": `Number("")` es 0 y sin el filtro
    // guardar el formulario habría borrado el umbral de toda la faena.
    expect(await minStockOf("stock-min-b")).toBe(7)
  })

  it("un 0 explícito sí borra el umbral", async () => {
    const result = await setMinStockBulkAction({ ok: false }, form("ws-min", [["stock-min-b", "0"]]))

    expect(result.ok).toBe(true)
    expect(await minStockOf("stock-min-b")).toBe(0)
  })

  it("rechaza el formulario sin ninguna celda escrita", async () => {
    const result = await setMinStockBulkAction({ ok: false }, form("ws-min", [
      ["stock-min-a", ""],
      ["stock-min-b", ""],
    ]))

    expect(result.ok).toBe(false)
    expect(result.message).toContain("al menos un mínimo")
  })

  it("no escribe nada si una fila apunta a otra faena", async () => {
    const result = await setMinStockBulkAction({ ok: false }, form("ws-min", [
      ["stock-min-a", "9"],
      ["stock-min-ajena", "9"],
    ]))

    expect(result.ok).toBe(false)
    // Toda la tanda cae junta: los ids viajan en el cliente, y una fila ajena no
    // puede colarse aprovechando que las otras eran válidas.
    expect(await minStockOf("stock-min-a")).toBe(0)
    expect(await minStockOf("stock-min-ajena")).toBe(0)
  })

  it("rechaza una faena fuera del alcance de la sesión", async () => {
    const result = await setMinStockBulkAction({ ok: false }, form("ws-min-other", [["stock-min-ajena", "3"]]))

    expect(result.ok).toBe(false)
    expect(result.message).toContain("acceso")
    expect(await minStockOf("stock-min-ajena")).toBe(0)
  })

  it("exige permiso de registro de movimientos", async () => {
    mockAuthFn.mockResolvedValue({
      user: { id: "user-min", permissions: ["warehouse:view_stock"], roles: [], worksiteIds: ["ws-min"], isGlobal: false },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    } as unknown as Session)

    const result = await setMinStockBulkAction({ ok: false }, form("ws-min", [["stock-min-a", "5"]]))

    expect(result.ok).toBe(false)
    expect(await minStockOf("stock-min-a")).toBe(0)
  })

  it("audita una vez por fila cambiada, no por fila enviada", async () => {
    await setMinStockBulkAction({ ok: false }, form("ws-min", [
      ["stock-min-a", "5"],
      ["stock-min-b", "7"],
    ]))

    const audits = await inMemoryDb
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, "worksite_stock"))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.entityId).toBe("stock-min-a")
  })

  it("avisa cuando no hubo cambios reales", async () => {
    const result = await setMinStockBulkAction({ ok: false }, form("ws-min", [["stock-min-b", "7"]]))

    expect(result.ok).toBe(true)
    expect(result.message).toContain("Sin cambios")
  })
})
