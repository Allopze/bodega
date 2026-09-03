/**
 * Integration tests for lib/services/stock.ts — getStockExport & getKardexExport.
 *
 * Uses PGlite in-memory database (same pattern as stock-service.test.ts).
 * Validates Excel output with ExcelJS, RBAC scoping, filters, and truncation.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import ExcelJS from "exceljs"
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
  CredentialsSignin: class CredentialsSignin extends Error {
    code: string
    constructor(message: string) {
      super(message)
      this.code = "generic"
    }
  },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { getStockExport, getKardexExport } from "@/lib/services/stock"
import { MOVEMENT_TYPE_LABELS } from "@/lib/movement-labels"

const now = new Date().toISOString()
const userId = "u-export"

// ── Session helpers ─────────────────────────────────────────────────────────

function globalSession() {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-global",
      name: "Usuario Global",
      email: "global@chome.cl",
      roles: ["administrador"],
      permissions: [],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
    },
  }
}

function scopedSession(worksiteIds: string[]) {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-scoped",
      name: "Usuario Faena",
      email: "faena@chome.cl",
      roles: ["solicitante_faena"],
      permissions: [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
  }
}

// ── Seed data ───────────────────────────────────────────────────────────────

const WS_1 = "ws-export-1"
const WS_2 = "ws-export-2"
const PROD_1 = "prod-export-1"
const PROD_2 = "prod-export-2"
const CAT = "cat-export"

async function seedMasterData() {
  await inMemoryDb.insert(schema.users).values({
    id: userId, name: "Bodeguero", email: "bodega@chome.cl",
    hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
  })

  await inMemoryDb.insert(schema.worksites).values([
    {
      id: WS_1, name: "Faena Alfa", code: "F-ALFA",
      isActive: true, createdAt: now, updatedAt: now,
    },
    {
      id: WS_2, name: "Faena Beta", code: "F-BETA",
      isActive: true, createdAt: now, updatedAt: now,
    },
  ])

  await inMemoryDb.insert(schema.productCategories).values({
    id: CAT, name: "EPP", slug: "epp", sortOrder: 1,
  })

  await inMemoryDb.insert(schema.products).values([
    {
      id: PROD_1, sku: "EPP-001", name: "Guantes Nitrilo",
      categoryId: CAT, unitOfMeasure: "par", isActive: true,
      createdAt: now, updatedAt: now,
    },
    {
      id: PROD_2, sku: "EPP-002", name: "Bota Seguridad",
      categoryId: CAT, unitOfMeasure: "par", isActive: true,
      createdAt: now, updatedAt: now,
    },
  ])
}

// ── Stock Export Tests ───────────────────────────────────────────────────────

describe("getStockExport", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await seedMasterData()
  })

  beforeEach(async () => {
    await inMemoryDb.delete(schema.worksiteStock)
    await inMemoryDb.delete(schema.inventoryMovements)
  })

  it("returns a valid Excel ArrayBuffer with stock rows", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values([
      {
        id: "stk-1", worksiteId: WS_1, productId: PROD_1,
        quantity: 20, minStock: 5, lastMovementAt: now, updatedAt: now,
      },
      {
        id: "stk-2", worksiteId: WS_1, productId: PROD_2,
        quantity: 10, minStock: 3, lastMovementAt: now, updatedAt: now,
      },
    ])

    const res = await getStockExport(globalSession())

    expect(res.buffer).toBeInstanceOf(ArrayBuffer)
    expect(res.truncated).toBe(false)
    expect(res.filename).toMatch(/^stock-por-faena-\d{4}-\d{2}-\d{2}\.xlsx$/)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Stock")
    expect(ws).toBeDefined()

    expect((ws?.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Faena", "Producto", "Talla", "SKU", "U/M", "Cantidad", "Stock mínimo", "Último movimiento",
    ])
    expect(ws?.actualRowCount).toBe(3) // header + 2 data rows
  })

  it("exporta la talla de cada variante en su propia columna", async () => {
    // El catálogo guarda una fila por talla con el mismo nombre: sin la columna
    // «Talla» la planilla no distingue la bota 42 de la 40.
    await inMemoryDb.insert(schema.productAttributes).values({
      id: "attr-bota-42", productId: PROD_2, categoryId: null,
      name: "Talla calzado", type: "select", isRequired: true,
      options: JSON.stringify(["42"]), sizeFamily: "calzado", sortOrder: 0,
    })
    try {
      await inMemoryDb.insert(schema.worksiteStock).values([
        { id: "stk-s1", worksiteId: WS_1, productId: PROD_1, quantity: 5, minStock: 0, lastMovementAt: now, updatedAt: now },
        { id: "stk-s2", worksiteId: WS_1, productId: PROD_2, quantity: 7, minStock: 0, lastMovementAt: now, updatedAt: now },
      ])

      const res = await getStockExport(globalSession())
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Buffer.from(res.buffer) as never)
      const ws = workbook.getWorksheet("Stock")

      // Ordena por nombre de producto: «Bota Seguridad» antes que «Guantes».
      expect(ws?.getCell("B2").value).toBe("Bota Seguridad")
      expect(ws?.getCell("C2").value).toBe("42")
      // Un producto sin talla deja la celda vacía, no un valor inventado.
      expect(ws?.getCell("B3").value).toBe("Guantes Nitrilo")
      expect(ws?.getCell("C3").value).toBe("")
    } finally {
      await inMemoryDb.delete(schema.productAttributes)
    }
  })

  it("filters by worksiteId", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values([
      {
        id: "stk-a", worksiteId: WS_1, productId: PROD_1,
        quantity: 20, minStock: 5, lastMovementAt: now, updatedAt: now,
      },
      {
        id: "stk-b", worksiteId: WS_2, productId: PROD_1,
        quantity: 30, minStock: 5, lastMovementAt: now, updatedAt: now,
      },
    ])

    const res = await getStockExport(globalSession(), { worksiteId: WS_1 })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Stock")
    expect(ws?.actualRowCount).toBe(2) // header + 1 data row
  })

  it("returns empty Excel when no stock exists", async () => {
    const res = await getStockExport(globalSession())

    expect(res.buffer).toBeInstanceOf(ArrayBuffer)
    expect(res.truncated).toBe(false)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Stock")
    expect(ws?.actualRowCount).toBe(1) // header only
  })

  it("truncates results at maxRows limit", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values([
      {
        id: "stk-t1", worksiteId: WS_1, productId: PROD_1,
        quantity: 10, minStock: 0, lastMovementAt: now, updatedAt: now,
      },
      {
        id: "stk-t2", worksiteId: WS_1, productId: PROD_2,
        quantity: 20, minStock: 0, lastMovementAt: now, updatedAt: now,
      },
      {
        id: "stk-t3", worksiteId: WS_2, productId: PROD_1,
        quantity: 30, minStock: 0, lastMovementAt: now, updatedAt: now,
      },
    ])

    const res = await getStockExport(globalSession(), {}, 2)

    expect(res.truncated).toBe(true)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Stock")
    expect(ws?.actualRowCount).toBe(3) // header + 2 data rows (truncated from 3)
  })

  it("respects RBAC scoping — scoped session sees only its worksites", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values([
      {
        id: "stk-s1", worksiteId: WS_1, productId: PROD_1,
        quantity: 50, minStock: 10, lastMovementAt: now, updatedAt: now,
      },
      {
        id: "stk-s2", worksiteId: WS_2, productId: PROD_1,
        quantity: 60, minStock: 10, lastMovementAt: now, updatedAt: now,
      },
    ])

    const res = await getStockExport(scopedSession([WS_1]))

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Stock")
    expect(ws?.actualRowCount).toBe(2) // header + 1 row
  })

  it("scoped session with no worksites returns empty", async () => {
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stk-empty", worksiteId: WS_1, productId: PROD_1,
      quantity: 10, minStock: 0, lastMovementAt: now, updatedAt: now,
    })

    const res = await getStockExport(scopedSession([]))

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Stock")
    expect(ws?.actualRowCount).toBe(1) // header only
  })
})

// ── Kardex Export Tests ─────────────────────────────────────────────────────

describe("getKardexExport", () => {
  // Master data and PGlite already seeded by getStockExport describe block

  beforeEach(async () => {
    await inMemoryDb.delete(schema.inventoryMovements)
  })

  afterAll(async () => { await pg.close() })

  it("returns a valid Excel ArrayBuffer with movement rows", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 10, stockBefore: 0, stockAfter: 10,
        performedBy: userId, performedAt: now,
        referenceType: "purchase_order", referenceId: "oc-1",
      },
      {
        id: "mov-2", worksiteId: WS_1, productId: PROD_1,
        type: "egreso_entrega", quantity: -3, stockBefore: 10, stockAfter: 7,
        performedBy: userId, performedAt: now,
        referenceType: "delivery", referenceId: "del-1",
        reason: "Entrega a trabajador",
      },
    ])

    const res = await getKardexExport(globalSession())

    expect(res.buffer).toBeInstanceOf(ArrayBuffer)
    expect(res.truncated).toBe(false)
    expect(res.filename).toMatch(/^kardex-movimientos-\d{4}-\d{2}-\d{2}\.xlsx$/)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws).toBeDefined()

    expect((ws?.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Fecha", "Faena", "Producto", "Talla", "SKU", "Tipo de movimiento",
      "Cantidad", "Stock anterior", "Stock posterior",
      "Responsable", "Motivo", "Observaciones",
    ])
    expect(ws?.actualRowCount).toBe(3) // header + 2

    expect(ws?.getCell("F2").value).toBe("Ingreso OC")
    expect(ws?.getCell("F3").value).toBe("Entrega")
  })

  it("filters by worksiteId", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-ws1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 5, stockBefore: 0, stockAfter: 5,
        performedBy: userId, performedAt: now,
      },
      {
        id: "mov-ws2", worksiteId: WS_2, productId: PROD_1,
        type: "ingreso_oc", quantity: 8, stockBefore: 0, stockAfter: 8,
        performedBy: userId, performedAt: now,
      },
    ])

    const res = await getKardexExport(globalSession(), { worksiteId: WS_1 })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(2) // header + 1 row
  })

  it("filters by productId", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-p1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 5, stockBefore: 0, stockAfter: 5,
        performedBy: userId, performedAt: now,
      },
      {
        id: "mov-p2", worksiteId: WS_1, productId: PROD_2,
        type: "ingreso_oc", quantity: 8, stockBefore: 0, stockAfter: 8,
        performedBy: userId, performedAt: now,
      },
    ])

    const res = await getKardexExport(globalSession(), { productId: PROD_1 })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(2) // header + 1 row
  })

  // `desde`/`hasta` se comparan como fechas desnudas, asi que Postgres las
  // resuelve en la zona de la sesion (Chile, fijada en compose y CI). El corte
  // es por dia chileno y no por dia UTC: un movimiento de las 00:30 UTC del 12
  // ocurrio a las 20:30 del 11 en faena, y para quien pide "hasta el 11" ese
  // movimiento es del 11. El caso esta fijado abajo a proposito.
  it("recorta por rango de fechas usando el dia chileno, con 'hasta' inclusive", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-r1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 1, stockBefore: 0, stockAfter: 1,
        performedBy: userId, performedAt: "2026-03-09T23:00:00Z", // 09-03 19:00 CL — fuera
      },
      {
        id: "mov-r2", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 2, stockBefore: 1, stockAfter: 3,
        performedBy: userId, performedAt: "2026-03-10T08:00:00Z", // 10-03 04:00 CL — dentro
      },
      {
        id: "mov-r3", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 3, stockBefore: 3, stockAfter: 6,
        performedBy: userId, performedAt: "2026-03-11T23:59:00Z", // 11-03 19:59 CL — dentro
      },
      {
        id: "mov-r4", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 4, stockBefore: 6, stockAfter: 10,
        performedBy: userId, performedAt: "2026-03-12T00:30:00Z", // 11-03 20:30 CL — dentro
      },
      {
        id: "mov-r5", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 5, stockBefore: 10, stockAfter: 15,
        performedBy: userId, performedAt: "2026-03-12T14:00:00Z", // 12-03 10:00 CL — fuera
      },
    ])

    const res = await getKardexExport(globalSession(), { from: "2026-03-10", to: "2026-03-11" })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(4) // header + r2 + r3 + r4
  })

  it("sin rango exporta todo el historico", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-s1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 1, stockBefore: 0, stockAfter: 1,
        performedBy: userId, performedAt: "2020-01-01T10:00:00Z",
      },
      {
        id: "mov-s2", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 1, stockBefore: 1, stockAfter: 2,
        performedBy: userId, performedAt: now,
      },
    ])

    const res = await getKardexExport(globalSession(), {})

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(3) // header + 2 rows
  })

  it("returns empty Excel when no movements exist", async () => {
    const res = await getKardexExport(globalSession())

    expect(res.buffer).toBeInstanceOf(ArrayBuffer)
    expect(res.truncated).toBe(false)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(1) // header only
  })

  it("truncates results at maxRows limit", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-t1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 1, stockBefore: 0, stockAfter: 1,
        performedBy: userId, performedAt: "2026-01-01T10:00:00Z",
      },
      {
        id: "mov-t2", worksiteId: WS_1, productId: PROD_1,
        type: "egreso_entrega", quantity: -1, stockBefore: 1, stockAfter: 0,
        performedBy: userId, performedAt: "2026-01-02T10:00:00Z",
      },
      {
        id: "mov-t3", worksiteId: WS_1, productId: PROD_2,
        type: "ingreso_oc", quantity: 5, stockBefore: 0, stockAfter: 5,
        performedBy: userId, performedAt: "2026-01-03T10:00:00Z",
      },
    ])

    const res = await getKardexExport(globalSession(), {}, 2)

    expect(res.truncated).toBe(true)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(3) // header + 2 data rows (truncated from 3)
  })

  it("respects RBAC scoping — scoped session sees only its worksite movements", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "mov-sc1", worksiteId: WS_1, productId: PROD_1,
        type: "ingreso_oc", quantity: 10, stockBefore: 0, stockAfter: 10,
        performedBy: userId, performedAt: now,
      },
      {
        id: "mov-sc2", worksiteId: WS_2, productId: PROD_1,
        type: "ingreso_oc", quantity: 20, stockBefore: 0, stockAfter: 20,
        performedBy: userId, performedAt: now,
      },
    ])

    const res = await getKardexExport(scopedSession([WS_1]))

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.actualRowCount).toBe(2) // header + 1 row (only WS_1)
  })

  it("maps egreso_desecho movement type to Spanish label", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values({
      id: "mov-des", worksiteId: WS_1, productId: PROD_1,
      type: "egreso_desecho", quantity: 2, stockBefore: 10, stockAfter: 10,
      performedBy: userId, performedAt: now,
      reason: "EPP dañado",
    })

    const res = await getKardexExport(globalSession())

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    // "Baja" y no "Retiro": el vocabulario de movimientos se unificó en
    // `lib/movement-labels.ts` y la exportación dejó de tener su propio mapa.
    // "Retiro" además ya nombra otra cosa (`retiro_epp_trabajador`).
    expect(ws?.getCell("F2").value).toBe(MOVEMENT_TYPE_LABELS.egreso_desecho)
  })

  it("maps ajuste movement type to Spanish label", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values({
      id: "mov-aj", worksiteId: WS_1, productId: PROD_1,
      type: "ajuste", quantity: 5, stockBefore: 0, stockAfter: 5,
      performedBy: userId, performedAt: now,
      reason: "Conciliación física",
    })

    const res = await getKardexExport(globalSession())

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.getCell("F2").value).toBe("Ajuste")
  })

  it("includes reason and notes in Excel rows", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values({
      id: "mov-reason", worksiteId: WS_1, productId: PROD_1,
      type: "egreso_entrega", quantity: -2, stockBefore: 10, stockAfter: 8,
      performedBy: userId, performedAt: now,
      reason: "Entrega a Juan Pérez",
      notes: "Turno mañana",
    })

    const res = await getKardexExport(globalSession())

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    // Column K = Motivo, Column L = Observaciones
    expect(ws?.getCell("K2").value).toBe("Entrega a Juan Pérez")
    expect(ws?.getCell("L2").value).toBe("Turno mañana")
  })

  it("renders empty strings for null reason and notes", async () => {
    await inMemoryDb.insert(schema.inventoryMovements).values({
      id: "mov-nulls", worksiteId: WS_1, productId: PROD_1,
      type: "ingreso_oc", quantity: 5, stockBefore: 0, stockAfter: 5,
      performedBy: userId, performedAt: now,
      // reason and notes default to null
    })

    const res = await getKardexExport(globalSession())

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)
    const ws = workbook.getWorksheet("Kardex")
    expect(ws?.getCell("K2").value).toBe("")
    expect(ws?.getCell("L2").value).toBe("")
  })
})
