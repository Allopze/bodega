import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { partsNoteSchema } from "@/lib/mantencion/contracts"
import { chargeOfCostCenter, chargeOfVehicle, NO_CHARGE, partsNoteInput } from "@/lib/mantencion/client/parts-request-model"
import {
  IDS,
  contextOf,
  createPartsNoteFromDevice,
  itemRow,
  link,
  makeProduct,
  manualNote,
  noteRow,
  orderFor,
  phoneNote,
  phoneOtNote,
  registerReceipt,
  requestFor,
  resetState,
  setupDatabase,
  testDb,
} from "./np-transiciones-fixtures"

vi.mock("@/db", () => ({
  get db() { return (globalThis as { __db?: unknown }).__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { buildCatalog } = await import("@/lib/services/mantencion/catalog")
const { catalogVersion, CATALOG_FORMAT } = await import("@/lib/services/mantencion/sync-catalog-version")
const { SPARE_PARTS_LIMIT } = await import("@/lib/services/mantencion/catalog")

/**
 * Catálogo del teléfono con «Mis notas» y el pedido sin OT (ADR 0001, 2026-11-27) contra Postgres de verdad: sólo las
 * notas de quien descarga (con y sin OT), la ventana de 30 días de las cerradas, el motivo de «En espera» y de «Anulada»,
 * el avance de lo recibido de una línea sin OT, los centros de costo de sus faenas, el permiso de pedir y la huella (ETag)
 * que cambia cuando llega algo. El pedido que arma la app (`partsNoteInput`) es el que el servidor recibe.
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

const catalogOf = async (userId: string, mutate?: (permissions: string[]) => string[]) => buildCatalog(await contextOf(userId, mutate))

/** Una nota sin OT de quien pide, por el mismo camino del teléfono. */
async function freeNote(userId: string, overrides: Parameters<typeof phoneNote>[0] = {}) {
  const result = await createPartsNoteFromDevice(phoneNote({ workOrderId: null, worksiteId: IDS.wsBio, equipmentStopped: false, ...overrides }), await contextOf(userId))
  if (result.status !== 200 || !result.body.ok) throw new Error(result.body.ok ? "no se creó" : result.body.message)
  return result.body.noteId
}

describe("«Mis notas» del catálogo: sólo las propias, con y sin OT", () => {
  it("trae las notas de quien descarga y ninguna de otros; cada una con su faena, OT, urgencia, observación y clientOpId", async () => {
    const free = phoneNote({ workOrderId: null, worksiteId: IDS.wsBio, equipmentStopped: false, urgent: true, notes: "Pedido de taller" })
    const created = await createPartsNoteFromDevice(free, await contextOf(IDS.mecBio))
    expect(created.status).toBe(200)
    const withOt = await phoneOtNote({ equipmentStopped: true })
    await freeNote(IDS.mecBio2)            // de otro mecánico de la misma faena
    await manualNote()                       // de jefatura

    const mine = (await catalogOf(IDS.mecBio)).ownPartsNotes ?? []
    expect(mine).toHaveLength(2)
    const noOt = mine.find((note) => note.workOrderId === null)!
    expect(noOt).toMatchObject({
      clientOpId: free.id, urgent: true, notes: "Pedido de taller", statusReason: null, status: "enviada",
      worksiteId: IDS.wsBio, worksiteName: "Biodiversa", workOrderFolio: null, equipmentCode: null, equipmentPlate: null,
    })
    expect(noOt.lines.map((line) => [line.description, line.quantity, line.stage, line.arrived])).toEqual([["Filtro de aceite", 2, "pedido", 0], ["Aceite hidráulico", 20, "pedido", 0]])
    const ot = mine.find((note) => note.id === withOt.noteId)!
    expect(ot).toMatchObject({ workOrderFolio: "OT-TR-1", equipmentCode: "KA-135", equipmentPlate: "RBYD-98", urgent: true, equipmentStopped: true })

    // El otro mecánico y la jefatura ven sólo lo suyo; ninguno ve lo de Javier.
    expect((await catalogOf(IDS.mecBio2)).ownPartsNotes).toHaveLength(1)
    expect((await catalogOf(IDS.jefe)).ownPartsNotes).toHaveLength(1)
  })

  it("las abiertas van siempre; las cerradas, rechazadas y anuladas sólo si cambiaron en los últimos 30 días", async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
    const open = await freeNote(IDS.mecBio)
    const oldOpen = await freeNote(IDS.mecBio)
    await testDb.update(schema.mantPartsNotes).set({ createdAt: old, updatedAt: old }).where(eq(schema.mantPartsNotes.id, oldOpen))
    const oldRejected = await freeNote(IDS.mecBio)
    const recentRejected = await freeNote(IDS.mecBio)
    await testDb.update(schema.mantPartsNotes).set({ status: "rechazada", updatedAt: old }).where(eq(schema.mantPartsNotes.id, oldRejected))
    await testDb.update(schema.mantPartsNotes).set({ status: "rechazada", updatedAt: recent }).where(eq(schema.mantPartsNotes.id, recentRejected))

    const ids = ((await catalogOf(IDS.mecBio)).ownPartsNotes ?? []).map((note) => note.id)
    expect(ids).toContain(open)
    expect(ids).toContain(oldOpen)
    expect(ids).toContain(recentRejected)
    expect(ids).not.toContain(oldRejected)
  })

  it("En espera trae el motivo de la espera y Anulada el de la anulación; las demás, ninguno", async () => {
    const waiting = await freeNote(IDS.mecBio)
    const voided = await freeNote(IDS.mecBio)
    const plain = await freeNote(IDS.mecBio)
    await testDb.update(schema.mantPartsNotes).set({ status: "en_espera", holdReason: "Espera la cotización del proveedor" }).where(eq(schema.mantPartsNotes.id, waiting))
    await testDb.update(schema.mantPartsNotes).set({
      status: "anulada", voidedAt: new Date().toISOString(), voidedByUserId: IDS.jefe, voidReason: "Se pidió dos veces",
    }).where(eq(schema.mantPartsNotes.id, voided))
    const notes = (await catalogOf(IDS.mecBio)).ownPartsNotes ?? []
    const reasonOf = (id: string) => notes.find((note) => note.id === id)?.statusReason
    expect(reasonOf(waiting)).toBe("Espera la cotización del proveedor")
    expect(reasonOf(voided)).toBe("Se pidió dos veces")
    expect(reasonOf(plain)).toBeNull()
  })

  it("una línea rechazada trae su motivo, y lo que llegó de una línea SIN OT sale de la OC recibida en faena", async () => {
    const product = await makeProduct("Rodamiento 6205")
    const noteId = await freeNote(IDS.mecBio, { lines: [
      { description: "Rodamiento 6205", quantity: 3, unitOfMeasure: "unidad", partNumber: null, productId: product },
      { description: "Sello", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null },
    ] })
    const [first, second] = (await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(schema.mantPartsNoteItems.sortOrder))
    await testDb.update(schema.mantPartsNoteItems).set({
      resolution: "rechazada", resolutionReason: "Ya hay en bodega", resolvedByUserId: IDS.jefe, resolvedAt: new Date().toISOString(),
    }).where(eq(schema.mantPartsNoteItems.id, second!.id))
    const request = await requestFor(first!.id, "purchased")
    await link(first!.id, request.itemId)
    const order = await orderFor(request.itemId, product, 3)
    await registerReceipt({
      purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 2 }],
    })

    const note = ((await catalogOf(IDS.mecBio)).ownPartsNotes ?? []).find((entry) => entry.id === noteId)!
    expect(note.status).toBe("recibida_parcial")
    expect(note.lines.map((line) => [line.stage, line.arrived, line.quantity, line.rejectionReason])).toEqual([
      ["en_bodega", 2, 3, null],
      ["rechazado", 0, 1, "Ya hay en bodega"],
    ])
  })

  it("un pedido armado por la app (con faena, urgencia y cargo por línea) lo recibe el servidor tal cual y vuelve en el catálogo", async () => {
    const input = partsNoteInput({
      id: crypto.randomUUID(), deviceId: crypto.randomUUID(), appVersion: "test", createdAt: new Date().toISOString(),
      worksiteId: IDS.wsBio, equipmentStopped: false, urgent: true, notes: "Para el taller",
      lines: [
        { description: "Cable de acero", quantity: 2, partNumber: "CA-1", charge: chargeOfVehicle(IDS.truckBio) },
        { description: "Guantes de cuero", quantity: 6, partNumber: "", charge: chargeOfCostCenter("cc-tr-bio") },
        { description: "Silicona", quantity: 1, partNumber: "", charge: NO_CHARGE },
      ],
    })
    const payload = partsNoteSchema.parse(input)
    const result = await createPartsNoteFromDevice(payload, await contextOf(IDS.mecBio))
    expect(result).toMatchObject({ status: 200, body: { ok: true, duplicate: false } })
    // El reintento con el MISMO id (la respuesta se perdió) es un duplicado, no una nota nueva.
    const again = await createPartsNoteFromDevice(payload, await contextOf(IDS.mecBio))
    expect(again).toMatchObject({ status: 200, body: { ok: true, duplicate: true } })

    const noteId = result.body.ok ? result.body.noteId : ""
    expect(await noteRow(noteId)).toMatchObject({ workOrderId: null, worksiteId: IDS.wsBio, urgent: true, notes: "Para el taller", requestedByUserId: IDS.mecBio })
    const items = await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(schema.mantPartsNoteItems.sortOrder)
    expect(items.map((item) => [item.chargeVehicleId, item.chargeCostCenterId])).toEqual([[IDS.truckBio, null], [null, "cc-tr-bio"], [null, null]])
    expect(await itemRow(items[0]!.id)).toMatchObject({ partNumber: "CA-1" })

    const catalog = await catalogOf(IDS.mecBio)
    expect(catalog.ownPartsNotes?.filter((note) => note.clientOpId === payload.id)).toHaveLength(1)
  })
})

describe("centros de costo, permiso de pedir y huella del catálogo", () => {
  it("el mecánico baja los centros de costo de SUS faenas y el permiso de pedir", async () => {
    const catalog = await catalogOf(IDS.mecBio)
    expect(catalog.user.canRequestParts).toBe(true)
    expect(catalog.costCenters).toEqual([{ id: "cc-tr-bio", name: "Taller Biodiversa", worksiteId: IDS.wsBio }])
    const other = await catalogOf(IDS.mecCho)
    expect(other.costCenters).toEqual([{ id: "cc-tr-cho", name: "Taller Cholguán", worksiteId: IDS.wsCho }])
  })

  it("un centro de costo inactivo no se ofrece", async () => {
    await testDb.update(schema.costCenters).set({ isActive: false }).where(eq(schema.costCenters.id, "cc-tr-bio"))
    try {
      expect((await catalogOf(IDS.mecBio)).costCenters).toEqual([])
    } finally {
      await testDb.update(schema.costCenters).set({ isActive: true }).where(eq(schema.costCenters.id, "cc-tr-bio"))
    }
  })

  it("sin mant:np:create no se ofrece pedir ni centros de costo; con sólo view_own se ven las propias", async () => {
    await freeNote(IDS.mecBio)
    const noCreate = await catalogOf(IDS.mecBio, (permissions) => permissions.filter((permission) => permission !== "mant:np:create"))
    expect(noCreate.user.canRequestParts).toBe(false)
    expect(noCreate.costCenters).toBeUndefined()
    expect(noCreate.ownPartsNotes).toHaveLength(1)

    const none = await catalogOf(IDS.mecBio, (permissions) => permissions.filter((permission) => permission !== "mant:np:create" && permission !== "mant:np:view_own"))
    expect(none.user.canRequestParts).toBe(false)
    expect(none.ownPartsNotes).toBeUndefined()
    expect(none.costCenters).toBeUndefined()
  })

  it("el formato del catálogo es 8", () => {
    expect(CATALOG_FORMAT).toBe(8)
  })

  it("la huella cambia con una nota nueva y con una segunda recepción parcial que no mueve el estado de la nota", async () => {
    const viewer = (await contextOf(IDS.mecBio)).viewer
    const before = await catalogVersion(viewer, "mias")
    const product = await makeProduct("Filtro de aire")
    const noteId = await freeNote(IDS.mecBio, { lines: [{ description: "Filtro de aire", quantity: 4, unitOfMeasure: "unidad", partNumber: null, productId: product }] })
    const afterNote = await catalogVersion(viewer, "mias")
    expect(afterNote).not.toBe(before)

    const [item] = await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId))
    const request = await requestFor(item!.id, "purchased")
    await link(item!.id, request.itemId)
    const order = await orderFor(request.itemId, product, 4)
    const receive = (quantity: number) => registerReceipt({
      purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: quantity }],
    })
    await receive(1)
    const firstPartial = await catalogVersion(viewer, "mias")
    expect(firstPartial).not.toBe(afterNote)
    const noteBefore = await noteRow(noteId)
    await receive(1)
    // La nota sigue «recibida parcial» (no se reescribe) pero «Llegó» pasó de 1 a 2: el teléfono tiene que enterarse.
    expect((await noteRow(noteId)).updatedAt).toBe(noteBefore.updatedAt)
    expect(await catalogVersion(viewer, "mias")).not.toBe(firstPartial)
    const note = ((await catalogOf(IDS.mecBio)).ownPartsNotes ?? []).find((entry) => entry.id === noteId)!
    expect(note.lines[0]).toMatchObject({ stage: "en_bodega", arrived: 2, quantity: 4 })
  })
})

/**
 * Un producto del catálogo de productos. La marca de tiempo del repuesto la mueve el disparador `products_set_updated_at`
 * de la base en cada UPDATE (igual que en producción): la huella no depende de que el código se acuerde de tocarla.
 */
async function addProduct(id: string, fields: Partial<typeof schema.products.$inferInsert> = {}) {
  const at = new Date().toISOString()
  await testDb.insert(schema.products).values({
    id, sku: `BUS-${id}`, name: `Producto ${id}`, categoryId: "cat-tr", unitOfMeasure: "unidad", isSparePart: true, partNumber: `PN-${id}`,
    isActive: true, createdAt: at, updatedAt: at, ...fields,
  })
}
const touch = async (id: string, fields: Partial<typeof schema.products.$inferInsert>) => {
  await new Promise((resolve) => setTimeout(resolve, 5))
  await testDb.update(schema.products).set(fields).where(eq(schema.products.id, id))
}

describe("repuestos del catálogo para el buscador de la app (R15)", () => {
  it("el mecánico con mant:np:create baja los repuestos activos (id, nombre, SKU, N° de parte y unidad, por nombre) y nada más", async () => {
    await addProduct("bus-b", { name: "Bujía de precalentamiento", sku: "REP-BUS-B", partNumber: "BP-1", unitOfMeasure: "unidad", referencePrice: 12_345 })
    await addProduct("bus-a", { name: "Aceite hidráulico ISO 68", sku: "REP-BUS-A", partNumber: null, unitOfMeasure: "litro" })
    await addProduct("bus-inactivo", { name: "Repuesto retirado", isActive: false })
    await addProduct("bus-epp", { name: "Guante de cuero", isSparePart: false })

    const catalog = await catalogOf(IDS.mecBio)
    const mine = (catalog.spareParts ?? []).filter((part) => part.id.startsWith("bus-"))
    expect(mine).toEqual([
      { id: "bus-a", name: "Aceite hidráulico ISO 68", sku: "REP-BUS-A", partNumber: null, unit: "litro" },
      { id: "bus-b", name: "Bujía de precalentamiento", sku: "REP-BUS-B", partNumber: "BP-1", unit: "unidad" },
    ])
    // Sólo identidad: ni precios, ni proveedores, ni nada más viaja al teléfono.
    for (const part of catalog.spareParts ?? []) expect(Object.keys(part).sort()).toEqual(["id", "name", "partNumber", "sku", "unit"])
  })

  it("el de otra faena también los baja (el catálogo de repuestos no es por faena); sin mant:np:create, aunque vea sus notas, no los recibe", async () => {
    await addProduct("bus-perm")
    expect((await catalogOf(IDS.mecCho)).spareParts?.some((part) => part.id === "bus-perm")).toBe(true)

    const noCreate = await catalogOf(IDS.mecBio, (permissions) => permissions.filter((permission) => permission !== "mant:np:create"))
    expect(noCreate.spareParts).toBeUndefined()
    expect(noCreate.ownPartsNotes).toBeDefined()
    const none = await catalogOf(IDS.mecBio, (permissions) => permissions.filter((permission) => permission !== "mant:np:create" && permission !== "mant:np:view_own"))
    expect(none.spareParts).toBeUndefined()
  })

  it("el tope de repuestos existe y es holgado respecto del catálogo real", () => {
    expect(SPARE_PARTS_LIMIT).toBeGreaterThanOrEqual(1000)
  })

  it("la huella cambia al crear, renombrar o desactivar un repuesto, y no al tocar lo que no es repuesto ni un repuesto inactivo", async () => {
    const viewer = (await contextOf(IDS.mecBio)).viewer
    const v0 = await catalogVersion(viewer, "mias")

    // Un producto que no es repuesto (EPP, insumo) no cambia lo que baja el teléfono: no hay motivo para otra descarga.
    await addProduct("fp-epp", { isSparePart: false })
    await touch("fp-epp", { name: "Guante renombrado" })
    expect(await catalogVersion(viewer, "mias")).toBe(v0)

    await addProduct("fp-rep", { name: "Retén de eje" })
    const v1 = await catalogVersion(viewer, "mias")
    expect(v1).not.toBe(v0)

    await touch("fp-rep", { name: "Retén de eje trasero" })
    const v2 = await catalogVersion(viewer, "mias")
    expect(v2).not.toBe(v1)

    await touch("fp-rep", { partNumber: "RET-99", unitOfMeasure: "par" })
    const v3 = await catalogVersion(viewer, "mias")
    expect(v3).not.toBe(v2)

    await touch("fp-rep", { isActive: false })
    const v4 = await catalogVersion(viewer, "mias")
    expect(v4).not.toBe(v3)
    expect((await catalogOf(IDS.mecBio)).spareParts?.some((part) => part.id === "fp-rep")).toBe(false)

    // Ya inactivo, editarlo no mueve nada.
    await touch("fp-rep", { name: "Retén de eje, retirado" })
    expect(await catalogVersion(viewer, "mias")).toBe(v4)

    await touch("fp-rep", { isActive: true })
    expect(await catalogVersion(viewer, "mias")).not.toBe(v4)
  })

  it("quitar mant:np:create cambia la huella: el teléfono tiene que bajar el catálogo sin repuestos", async () => {
    const viewer = (await contextOf(IDS.mecBio)).viewer
    const withPermission = await catalogVersion(viewer, "mias")
    const without = await catalogVersion({ ...viewer, permissions: viewer.permissions.filter((permission) => permission !== "mant:np:create") }, "mias")
    expect(without).not.toBe(withPermission)
  })
})
