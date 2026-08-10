/**
 * Guías de Despacho Internas (GDI) — integración sobre Postgres (PGlite).
 *
 * Cubre el contrato completo del documento: origen automático, correlativo,
 * concurrencia, integración con Bodega (dos patas por línea), estados,
 * anulación con reversa, alcance por faena y consulta histórica.
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

import {
  cancelDispatchGuide,
  confirmDispatchGuideReceipt,
  createDispatchGuide,
  dispatchDispatchGuide,
  getDispatchGuideDetail,
  listDispatchGuides,
  countDispatchGuides,
  listOfficeStockOptions,
  resolveOfficeWorksite,
  OFFICE_WORKSITE_SETTING_KEY,
} from "@/lib/services/dispatch-guides"
import { dispatchGuideInputSchema } from "@/lib/validation/dispatch-guides"

const now = new Date().toISOString()
const OFFICE = "ws-oficina"
const FAENA = "ws-faena"
const OTHER_FAENA = "ws-otra"
const ISSUER = { userId: "u-bodega", userEmail: "bodega@chome.cl" }
const FAENA_ACTOR = { userId: "u-faena", userEmail: "faena@chome.cl" }

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

async function setOfficeStock(productId: string, quantity: number) {
  await inMemoryDb
    .insert(schema.worksiteStock)
    .values({ id: `stk-${OFFICE}-${productId}`, worksiteId: OFFICE, productId, quantity, minStock: 0, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.worksiteStock.worksiteId, schema.worksiteStock.productId],
      set: { quantity },
    })
}

async function stockAt(worksiteId: string, productId: string) {
  const row = await inMemoryDb.query.worksiteStock.findFirst({
    where: and(eq(schema.worksiteStock.worksiteId, worksiteId), eq(schema.worksiteStock.productId, productId)),
  })
  return row?.quantity ?? 0
}

/** Entrada mínima válida: nótese que NO existe campo de origen. */
function guideInput(overrides: Partial<Parameters<typeof createDispatchGuide>[0]> = {}) {
  return {
    destinationWorksiteId: FAENA,
    dispatcherWorkerId: "w-despacha",
    receiverWorkerId: "w-recibe",
    vehicleId: "veh-1",
    driverWorkerId: "w-conductor",
    notes: "Traslado de prueba",
    items: [{ productId: "p-casco", quantity: 10, unitOfMeasure: "unidad", notes: null }],
    ...overrides,
  } as Parameters<typeof createDispatchGuide>[0]
}

describe("Guías de Despacho Internas", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values([
      { id: ISSUER.userId, name: "Bodeguero", email: ISSUER.userEmail, hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: FAENA_ACTOR.userId, name: "Jefe Faena", email: FAENA_ACTOR.userEmail, hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.worksites).values([
      { id: OFFICE, name: "Administración", code: "FA-001", isActive: true, createdAt: now, updatedAt: now },
      { id: FAENA, name: "Faena Santa Fe", code: "FA-008", address: "Camino Santa Fe s/n", isActive: true, createdAt: now, updatedAt: now },
      { id: OTHER_FAENA, name: "Faena Teno", code: "FA-009", isActive: true, createdAt: now, updatedAt: now },
      { id: "ws-inactiva", name: "Faena Cerrada", code: "FA-010", isActive: false, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({ id: "cat-1", name: "General", slug: "general", sortOrder: 1 })
    await inMemoryDb.insert(schema.products).values([
      { id: "p-casco", sku: "EPP-001", name: "Casco de seguridad", categoryId: "cat-1", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
      { id: "p-guantes", sku: "EPP-002", name: "Guantes de cabritilla", categoryId: "cat-1", unitOfMeasure: "par", isActive: true, createdAt: now, updatedAt: now },
      { id: "p-monogas", sku: "EQ-001", name: "Detector monogás", categoryId: "cat-1", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
      { id: "p-inactivo", sku: "EPP-999", name: "Producto descontinuado", categoryId: "cat-1", unitOfMeasure: "unidad", isActive: false, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.workers).values([
      { id: "w-despacha", firstName: "Ana", lastName: "Bodega", rut: "11111111-1", worksiteId: OFFICE, isActive: true, createdAt: now },
      { id: "w-recibe", firstName: "Luis", lastName: "Faena", rut: "22222222-2", worksiteId: FAENA, isActive: true, createdAt: now },
      { id: "w-conductor", firstName: "Pedro", lastName: "Conductor", rut: "33333333-3", worksiteId: OFFICE, isActive: true, createdAt: now },
      { id: "w-inactivo", firstName: "Ex", lastName: "Colaborador", rut: "44444444-4", worksiteId: FAENA, isActive: false, createdAt: now },
    ])
    // Las migraciones ya siembran los tipos de equipo del sistema.
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: "fet-camioneta", slug: "camioneta", name: "Camioneta", category: "light", createdAt: now, updatedAt: now,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: "veh-1", plate: "ABCD-12", code: "KA-63", type: "camioneta", equipmentTypeId: "fet-camioneta",
      brand: "Toyota", model: "Hilux", worksiteId: OFFICE, responsibleUserId: ISSUER.userId,
      isActive: true, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  beforeEach(async () => {
    await setOfficeStock("p-casco", 100)
    await setOfficeStock("p-guantes", 50)
    await setOfficeStock("p-monogas", 3)
  })

  /* ── Creación ─────────────────────────────────────────────────────────── */

  it("crea la guía con origen Oficina automático y destino la faena elegida", async () => {
    const { id, code } = await createDispatchGuide(guideInput(), ISSUER)

    const detail = await getDispatchGuideDetail(id)
    expect(detail).not.toBeNull()
    expect(detail!.guide.originWorksiteId).toBe(OFFICE)
    expect(detail!.guide.destinationWorksiteId).toBe(FAENA)
    expect(detail!.guide.status).toBe("draft")
    expect(detail!.guide.issuedBy).toBe(ISSUER.userId)
    expect(detail!.guide.issuedAt).toBeTruthy()
    expect(code).toMatch(/^GDI-\d{6}$/)
    // Un borrador no mueve stock.
    expect(detail!.movements).toHaveLength(0)
    expect(await stockAt(OFFICE, "p-casco")).toBe(100)
  })

  it("registra el historial de estado y la auditoría al crear", async () => {
    const { id, code } = await createDispatchGuide(guideInput(), ISSUER)

    const history = await inMemoryDb.query.statusHistory.findMany({
      where: eq(schema.statusHistory.entityId, id),
    })
    expect(history.map((row) => row.toStatus)).toContain("draft")

    const audit = await inMemoryDb.query.auditLog.findMany({
      where: eq(schema.auditLog.entityId, id),
    })
    expect(audit.some((row) => row.action === "create" && row.entityCode === code)).toBe(true)
  })

  it("acepta múltiples productos en una misma guía", async () => {
    const { id } = await createDispatchGuide(guideInput({
      items: [
        { productId: "p-casco", quantity: 10, unitOfMeasure: "unidad", notes: null },
        { productId: "p-guantes", quantity: 15, unitOfMeasure: "par", notes: "Talla M" },
        { productId: "p-monogas", quantity: 1, unitOfMeasure: "unidad", notes: null },
      ],
    }), ISSUER)

    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.items).toHaveLength(3)
    expect(detail!.guide.items.map((item) => item.productId)).toEqual(["p-casco", "p-guantes", "p-monogas"])
  })

  it("emite correlativos únicos y consecutivos", async () => {
    const first = await createDispatchGuide(guideInput(), ISSUER)
    const second = await createDispatchGuide(guideInput(), ISSUER)
    const firstSeq = Number(first.code.slice(4))
    expect(second.code).toBe(`GDI-${String(firstSeq + 1).padStart(6, "0")}`)
  })

  it("no repite el correlativo con creaciones concurrentes", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createDispatchGuide(guideInput(), ISSUER)),
    )
    const codes = results.map((result) => result.code)
    expect(new Set(codes).size).toBe(10)
  })

  it("rechaza cantidades no positivas en la validación de entrada", () => {
    for (const quantity of [0, -3]) {
      const parsed = dispatchGuideInputSchema.safeParse({
        destinationWorksiteId: FAENA,
        items: [{ productId: "p-casco", quantity, unitOfMeasure: "unidad" }],
      })
      expect(parsed.success).toBe(false)
    }
  })

  it("rechaza una guía sin elementos y con productos repetidos", () => {
    expect(dispatchGuideInputSchema.safeParse({ destinationWorksiteId: FAENA, items: [] }).success).toBe(false)
    expect(dispatchGuideInputSchema.safeParse({
      destinationWorksiteId: FAENA,
      items: [
        { productId: "p-casco", quantity: 1, unitOfMeasure: "unidad" },
        { productId: "p-casco", quantity: 2, unitOfMeasure: "unidad" },
      ],
    }).success).toBe(false)
  })

  it("rechaza destinos inválidos: inexistente, inactivo, o la propia oficina", async () => {
    await expect(createDispatchGuide(guideInput({ destinationWorksiteId: "ws-fantasma" }), ISSUER))
      .rejects.toThrow(/no existe/i)
    await expect(createDispatchGuide(guideInput({ destinationWorksiteId: "ws-inactiva" }), ISSUER))
      .rejects.toThrow(/no está activa/i)
    // Oficina → Oficina no es un traslado: se rechaza antes de tocar la BD.
    await expect(createDispatchGuide(guideInput({ destinationWorksiteId: OFFICE }), ISSUER))
      .rejects.toThrow(/distinta de la bodega de origen/i)
  })

  it("rechaza productos inexistentes o inactivos y colaboradores inválidos", async () => {
    await expect(createDispatchGuide(guideInput({
      items: [{ productId: "p-fantasma", quantity: 1, unitOfMeasure: "unidad", notes: null }],
    }), ISSUER)).rejects.toThrow(/no existe en el catálogo/i)
    await expect(createDispatchGuide(guideInput({
      items: [{ productId: "p-inactivo", quantity: 1, unitOfMeasure: "unidad", notes: null }],
    }), ISSUER)).rejects.toThrow(/no disponible/i)
    await expect(createDispatchGuide(guideInput({ receiverWorkerId: "w-inactivo" }), ISSUER))
      .rejects.toThrow(/inactivo/i)
    await expect(createDispatchGuide(guideInput({ vehicleId: "veh-fantasma" }), ISSUER))
      .rejects.toThrow(/vehículo indicado no existe/i)
  })

  it("respeta el alcance por faena del actor", async () => {
    await expect(createDispatchGuide(guideInput(), ISSUER, [OTHER_FAENA]))
      .rejects.toThrow(/no tienes acceso/i)
    // Con la faena en el alcance sí puede.
    await expect(createDispatchGuide(guideInput(), ISSUER, [FAENA])).resolves.toBeTruthy()
  })

  /* ── Despacho ─────────────────────────────────────────────────────────── */

  it("al despachar descuenta en la oficina, abona en la faena y sella el documento", async () => {
    const officeBefore = await stockAt(OFFICE, "p-casco")
    const faenaBefore = await stockAt(FAENA, "p-casco")

    const { id, code } = await createDispatchGuide(guideInput(), ISSUER)
    const result = await dispatchDispatchGuide(id, ISSUER)

    expect(result.code).toBe(code)
    expect(result.movements).toBe(2)
    expect(await stockAt(OFFICE, "p-casco")).toBe(officeBefore - 10)
    expect(await stockAt(FAENA, "p-casco")).toBe(faenaBefore + 10)

    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("dispatched")
    expect(detail!.guide.dispatchedAt).toBeTruthy()
    expect(detail!.guide.dispatchedBy).toBe(ISSUER.userId)

    // Trazabilidad guía ↔ movimiento en los dos sentidos.
    expect(detail!.movements).toHaveLength(2)
    expect(detail!.movements.map((movement) => movement.type).sort())
      .toEqual(["egreso_traslado", "ingreso_traslado"])
    const linked = await inMemoryDb.query.inventoryMovements.findMany({
      where: eq(schema.inventoryMovements.referenceId, id),
    })
    expect(linked).toHaveLength(2)
    expect(linked.every((movement) => movement.referenceType === "dispatch_guide")).toBe(true)
  })

  it("no descuenta dos veces la misma guía", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await dispatchDispatchGuide(id, ISSUER)
    const officeAfterFirst = await stockAt(OFFICE, "p-casco")

    await expect(dispatchDispatchGuide(id, ISSUER)).rejects.toThrow(/ya fue despachada/i)
    expect(await stockAt(OFFICE, "p-casco")).toBe(officeAfterFirst)
    const movements = await inMemoryDb.query.inventoryMovements.findMany({
      where: eq(schema.inventoryMovements.referenceId, id),
    })
    expect(movements).toHaveLength(2)
  })

  it("con despachos concurrentes de la misma guía solo uno mueve stock", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    const officeBefore = await stockAt(OFFICE, "p-casco")

    const results = await Promise.allSettled([
      dispatchDispatchGuide(id, ISSUER),
      dispatchDispatchGuide(id, ISSUER),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(await stockAt(OFFICE, "p-casco")).toBe(officeBefore - 10)
  })

  it("bloquea el despacho sin stock suficiente en la oficina", async () => {
    await setOfficeStock("p-monogas", 1)
    const { id } = await createDispatchGuide(guideInput({
      items: [{ productId: "p-monogas", quantity: 5, unitOfMeasure: "unidad", notes: null }],
    }), ISSUER)

    await expect(dispatchDispatchGuide(id, ISSUER)).rejects.toThrow(/stock insuficiente/i)
    expect(await stockAt(OFFICE, "p-monogas")).toBe(1)
    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("draft")
    expect(detail!.movements).toHaveLength(0)
  })

  it("nunca deja stock negativo aunque el saldo baje entre la creación y el despacho", async () => {
    const { id } = await createDispatchGuide(guideInput({
      items: [{ productId: "p-guantes", quantity: 40, unitOfMeasure: "par", notes: null }],
    }), ISSUER)
    await setOfficeStock("p-guantes", 5)

    await expect(dispatchDispatchGuide(id, ISSUER)).rejects.toThrow(/stock insuficiente/i)
    expect(await stockAt(OFFICE, "p-guantes")).toBe(5)
  })

  /* ── Recepción ────────────────────────────────────────────────────────── */

  it("confirma la recepción sin volver a mover stock", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await dispatchDispatchGuide(id, ISSUER)
    const officeAfterDispatch = await stockAt(OFFICE, "p-casco")
    const faenaAfterDispatch = await stockAt(FAENA, "p-casco")

    await confirmDispatchGuideReceipt(id, { receivedByWorkerId: "w-recibe" }, FAENA_ACTOR)

    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("received")
    expect(detail!.guide.receivedBy).toBe(FAENA_ACTOR.userId)
    expect(detail!.guide.receivedByWorkerId).toBe("w-recibe")
    expect(detail!.guide.receivedAt).toBeTruthy()
    expect(detail!.movements).toHaveLength(2)
    expect(await stockAt(OFFICE, "p-casco")).toBe(officeAfterDispatch)
    expect(await stockAt(FAENA, "p-casco")).toBe(faenaAfterDispatch)
  })

  it("no permite confirmar dos veces la recepción", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await dispatchDispatchGuide(id, ISSUER)
    await confirmDispatchGuideReceipt(id, {}, FAENA_ACTOR)
    await expect(confirmDispatchGuideReceipt(id, {}, FAENA_ACTOR)).rejects.toThrow(/ya fue confirmada/i)
  })

  it("no permite confirmar la recepción de un borrador", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await expect(confirmDispatchGuideReceipt(id, {}, FAENA_ACTOR)).rejects.toThrow(/todavía no ha sido despachada/i)
  })

  /* ── Anulación ────────────────────────────────────────────────────────── */

  it("anula un borrador sin generar movimientos", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    const result = await cancelDispatchGuide(id, { reason: "Emitida por error" }, ISSUER)

    expect(result.reversedMovements).toBe(0)
    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("cancelled")
    expect(detail!.guide.cancellationReason).toBe("Emitida por error")
    expect(detail!.guide.cancelledBy).toBe(ISSUER.userId)
    expect(detail!.movements).toHaveLength(0)
  })

  it("anula una guía despachada revirtiendo el stock con movimientos nuevos", async () => {
    const officeBefore = await stockAt(OFFICE, "p-casco")
    const faenaBefore = await stockAt(FAENA, "p-casco")

    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await dispatchDispatchGuide(id, ISSUER)
    const result = await cancelDispatchGuide(id, { reason: "La carga no salió de oficina" }, ISSUER)

    expect(result.reversedMovements).toBe(2)
    expect(await stockAt(OFFICE, "p-casco")).toBe(officeBefore)
    expect(await stockAt(FAENA, "p-casco")).toBe(faenaBefore)

    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("cancelled")
    // El despacho original se conserva: 2 movimientos + 2 de reversa.
    expect(detail!.movements).toHaveLength(4)
    const history = await inMemoryDb.query.statusHistory.findMany({
      where: eq(schema.statusHistory.entityId, id),
    })
    expect(history.some((row) => row.toStatus === "cancelled" && row.reason === "La carga no salió de oficina")).toBe(true)
  })

  it("exige motivo para anular", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await expect(cancelDispatchGuide(id, { reason: "no" }, ISSUER)).rejects.toThrow(/motivo/i)
    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("draft")
  })

  it("no anula si la faena ya consumió lo despachado (evita stock negativo)", async () => {
    const { id } = await createDispatchGuide(guideInput({
      items: [{ productId: "p-guantes", quantity: 20, unitOfMeasure: "par", notes: null }],
    }), ISSUER)
    await dispatchDispatchGuide(id, ISSUER)

    // La faena entrega todo lo recibido: ya no hay qué devolver.
    await inMemoryDb
      .update(schema.worksiteStock)
      .set({ quantity: 0 })
      .where(and(
        eq(schema.worksiteStock.worksiteId, FAENA),
        eq(schema.worksiteStock.productId, "p-guantes"),
      ))

    await expect(cancelDispatchGuide(id, { reason: "Anulación tardía" }, ISSUER))
      .rejects.toThrow(/ya consumió/i)
    const detail = await getDispatchGuideDetail(id)
    expect(detail!.guide.status).toBe("dispatched")
  })

  it("no anula dos veces la misma guía", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await cancelDispatchGuide(id, { reason: "Duplicada por error" }, ISSUER)
    await expect(cancelDispatchGuide(id, { reason: "Otra vez" }, ISSUER)).rejects.toThrow(/ya está anulada/i)
  })

  it("no despacha una guía anulada", async () => {
    const { id } = await createDispatchGuide(guideInput(), ISSUER)
    await cancelDispatchGuide(id, { reason: "Se cayó el traslado" }, ISSUER)
    await expect(dispatchDispatchGuide(id, ISSUER)).rejects.toThrow(/anulada/i)
  })

  /* ── Consulta histórica ───────────────────────────────────────────────── */

  it("permite consultar el histórico con filtros por estado y faena", async () => {
    const target = await createDispatchGuide(guideInput({ destinationWorksiteId: OTHER_FAENA }), ISSUER)
    await dispatchDispatchGuide(target.id, ISSUER)

    const dispatched = await listDispatchGuides({ status: "dispatched", destinationWorksiteId: OTHER_FAENA, limit: 50 })
    expect(dispatched.some((row) => row.code === target.code)).toBe(true)
    expect(dispatched.every((row) => row.status === "dispatched")).toBe(true)

    const row = dispatched.find((item) => item.code === target.code)!
    expect(row.destinationWorksiteName).toBe("Faena Teno")
    expect(row.dispatcherName).toContain("Ana")
    expect(row.itemCount).toBe(1)
    expect(row.totalQuantity).toBe(10)

    const drafts = await countDispatchGuides({ status: "draft" })
    expect(drafts).toBeGreaterThan(0)
    const otherFaenaOnly = await listDispatchGuides({ destinationWorksiteId: OTHER_FAENA, limit: 50 })
    expect(otherFaenaOnly.every((item) => item.destinationWorksiteId === OTHER_FAENA)).toBe(true)
  })

  it("ofrece como catálogo solo los productos con saldo en la oficina", async () => {
    await setOfficeStock("p-monogas", 0)
    const options = await listOfficeStockOptions(OFFICE)
    expect(options.some((option) => option.productId === "p-casco")).toBe(true)
    expect(options.some((option) => option.productId === "p-monogas")).toBe(false)
    expect(options.some((option) => option.productId === "p-inactivo")).toBe(false)
  })

  /* ── Resolución del origen ────────────────────────────────────────────── */

  it("resuelve la oficina por nombre cuando no hay ajuste configurado", async () => {
    const office = await resolveOfficeWorksite()
    expect(office.id).toBe(OFFICE)
  })

  it("prefiere el ajuste explícito sobre el nombre y avisa si apunta a una faena inválida", async () => {
    await inMemoryDb.insert(schema.systemSettings).values({
      key: OFFICE_WORKSITE_SETTING_KEY, value: OTHER_FAENA, updatedAt: now,
    })
    expect((await resolveOfficeWorksite()).id).toBe(OTHER_FAENA)

    await inMemoryDb
      .update(schema.systemSettings)
      .set({ value: "ws-fantasma" })
      .where(eq(schema.systemSettings.key, OFFICE_WORKSITE_SETTING_KEY))
    await expect(resolveOfficeWorksite()).rejects.toThrow(/no existe o está inactiva/i)

    // Se limpia para no alterar al resto de la suite.
    await inMemoryDb.delete(schema.systemSettings)
      .where(eq(schema.systemSettings.key, OFFICE_WORKSITE_SETTING_KEY))
    expect((await resolveOfficeWorksite()).id).toBe(OFFICE)
  })
})
