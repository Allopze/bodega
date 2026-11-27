import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"
import { todayInChile } from "@/lib/utils"
import {
  IDS,
  NOW,
  OT_ID,
  expectInvariant,
  itemRow,
  link,
  makeProduct,
  manualNote,
  noteRow,
  orderFor,
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

const { persistRepuestoDraft, submitRepuestoRequest } = await import("@/lib/services/repuestos")
const { transferVehiclesTx } = await import("@/lib/services/fleet-transfers")
const { notifyPartsNoteLinesArrived } = await import("@/lib/services/mantencion/parts-notes/notifications")
const { confirmDispatchGuideReceipt, dispatchDispatchGuide } = await import("@/lib/services/dispatch-guides")

/**
 * La compra REAL de líneas de una nota de pedido SIN OT (ADR 0001, 2026-11-27), de punta a punta contra Postgres: guardar el
 * borrador de la solicitud de repuestos (`persistRepuestoDraft`) y enviarla (`submitRepuestoRequest`) con el servicio de
 * notas de verdad (no mockeado), y el aviso al autor cuando lo comprado llega a la faena.
 *
 *  - una línea sin OT se compra: el ítem va sin OT y con el equipo de cargo, y la nota pasa a «en compra»;
 *  - la faena de la solicitud tiene que ser la de la nota, y una OT en una línea sin OT se rechaza;
 *  - un equipo de cargo que dejó de servir (trasladado, de baja) no impide comprar: el ítem va sin equipo y el cargo se
 *    conserva en la línea; se revalida al enviar;
 *  - al enviar se revalida la nota (anulada, en espera, cerrada, rechazada) y la línea (rechazada, desde stock);
 *  - una recepción en faena avisa al autor de la nota una vez por recepción.
 */

const buyer = (worksiteIds: string[] = [IDS.wsBio, IDS.wsCho]) => ({
  user: { id: IDS.jefe, email: "jefe@chome.test", name: "Alexis Morales", permissions: ["repuestos:create", "mant:np:manage"], worksiteIds, isGlobal: false, roles: [] },
}) as unknown as Session

function draft(items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    worksiteId: IDS.wsBio, urgency: "high" as const, requiredDate: "2099-12-01", justification: null,
    items: items.map((item) => ({ description: "Manguera hidráulica", quantity: 2, unitOfMeasure: "unidad", vehicleId: "", workOrderId: "", estimatedUnitPrice: 10_000, ...item })),
    ...extra,
  }
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("Se esperaba que la operación fuera rechazada")
}

const savedItems = (requestId: string) => testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
const requestStatus = async (requestId: string) => (await testDb.select({ status: schema.purchaseRequests.status }).from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, requestId)))[0]?.status
const requestCount = async () => (await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length
const arrivalNotices = () => testDb.select().from(schema.notifications).where(eq(schema.notifications.type, "mant_np_arrived"))

beforeAll(async () => {
  await setupDatabase()
  // La bodega de origen de las guías (la oficina) se resuelve por su nombre.
  await testDb.insert(schema.worksites).values({ id: "ws-np-oficina", name: "Oficina CHOME", code: "OF-NP", isActive: true, createdAt: NOW, updatedAt: NOW })
})

beforeEach(resetState)

describe("comprar una línea de una nota sin OT", () => {
  it("el ítem va sin OT y con el equipo de cargo de la línea, la nota pasa a «en compra» y el envío sigue su curso", async () => {
    const note = await manualNote([{ description: "Manguera hidráulica", chargeVehicleId: IDS.truckBio }])
    const requestId = await persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }]))

    const [item] = await savedItems(requestId)
    expect(item).toMatchObject({ vehicleId: IDS.truckBio, workOrderId: null, partsNoteItemId: note.itemIds[0] })
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
    expect(await expectInvariant(note.noteId)).toBe("en_compra")

    await submitRepuestoRequest({ requestId, userId: IDS.jefe })
    expect(await requestStatus(requestId)).toBe("submitted")
    expect((await savedItems(requestId))[0]).toMatchObject({ status: "requested", vehicleId: IDS.truckBio, workOrderId: null })
  })

  it("lo que el formulario mande como equipo se ignora: manda el cargo de la línea (o ninguno)", async () => {
    const withCharge = await manualNote([{ description: "Manguera hidráulica", chargeVehicleId: IDS.truckBio }])
    const withoutCharge = await manualNote([{ description: "Abrazadera", chargeCostCenterId: "cc-tr-bio" }])
    const requestId = await persistRepuestoDraft(buyer(), draft([
      { partsNoteItemId: withCharge.itemIds[0], vehicleId: IDS.machineBio },
      { partsNoteItemId: withoutCharge.itemIds[0], vehicleId: IDS.machineBio, description: "Abrazadera" },
    ]))
    const items = await savedItems(requestId)
    expect(items.map((item) => item.vehicleId).sort()).toEqual([IDS.truckBio, null].sort())
  })
})

describe("lo que se rechaza al guardar el borrador", () => {
  it("una solicitud de otra faena no compra la línea de la nota, y no deja rastro", async () => {
    const note = await manualNote([{ description: "Manguera hidráulica", chargeVehicleId: IDS.truckBio }])
    const before = await requestCount()
    expect(await message(() => persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }], { worksiteId: IDS.wsCho }))))
      .toMatch(/es de otra faena: abre la solicitud desde la nota de pedido/)
    expect(await requestCount()).toBe(before)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect(await expectInvariant(note.noteId)).toBe("enviada")
  })

  it("una OT en una línea sin OT se rechaza, con o sin equipo en el ítem", async () => {
    const note = await manualNote([{ description: "Manguera hidráulica", chargeVehicleId: IDS.truckBio }])
    const expected = "La línea de la nota de pedido no tiene OT: quita la orden de trabajo de ese ítem"
    expect(await message(() => persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0], vehicleId: IDS.truckBio, workOrderId: OT_ID }])))).toBe(expected)
    expect(await message(() => persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0], vehicleId: "", workOrderId: OT_ID }])))).toBe(expected)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
  })

  it("quien no puede comprar lo pedido por una nota no lo compra", async () => {
    const note = await manualNote([{ description: "Manguera hidráulica" }])
    const plain = { user: { ...buyer().user, permissions: ["repuestos:create"] } } as unknown as Session
    expect(await message(() => persistRepuestoDraft(plain, draft([{ partsNoteItemId: note.itemIds[0] }])))).toMatch(/No tienes permiso para comprar/)
  })
})

describe("el equipo de cargo ya no sirve para la faena de la solicitud", () => {
  it("un equipo de baja o trasladado a otra faena no frena la compra: el ítem va sin equipo y el cargo sigue en la línea", async () => {
    const retired = await manualNote([{ description: "Sello de bomba", chargeVehicleId: IDS.truckBio }])
    await testDb.update(schema.mantPartsNoteItems).set({ chargeVehicleId: IDS.retired }).where(eq(schema.mantPartsNoteItems.id, retired.itemIds[0]!))

    const moved = await manualNote([{ description: "Cadena de oruga", chargeVehicleId: IDS.machineBio }])
    const today = todayInChile()
    const transfer = await testDb.transaction((tx) => transferVehiclesTx(
      tx as unknown as Tx,
      { userId: IDS.jefe, email: "jefe@chome.test", scope: "all" },
      { toWorksiteId: IDS.wsCho, effectiveDate: today, reason: "Refuerzo de la faena Cholguán", authorizedBy: "Gerencia", vehicleIds: [IDS.machineBio] },
      today,
    ))
    expect(transfer.ok).toBe(true)

    for (const [note, chargeVehicleId] of [[retired, IDS.retired], [moved, IDS.machineBio]] as const) {
      const requestId = await persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }]))
      expect((await savedItems(requestId))[0]).toMatchObject({ vehicleId: null, workOrderId: null, partsNoteItemId: note.itemIds[0] })
      // La línea conserva su cargo y queda comprada; la nota, en compra.
      expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "en_compra", chargeVehicleId })
      expect(await expectInvariant(note.noteId)).toBe("en_compra")
      // Autoguardar de nuevo el mismo borrador tampoco falla.
      await persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }], { id: requestId }))
      await submitRepuestoRequest({ requestId, userId: IDS.jefe })
      expect(await requestStatus(requestId)).toBe("submitted")
    }
  })

  it("al enviar se revalida: el equipo que se dio de baja después de guardar el borrador se suelta del ítem", async () => {
    const note = await manualNote([{ description: "Manguera hidráulica", chargeVehicleId: IDS.truckBio }])
    const requestId = await persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }]))
    expect((await savedItems(requestId))[0]!.vehicleId).toBe(IDS.truckBio)

    await testDb.update(schema.fuelVehicles).set({ isActive: false }).where(eq(schema.fuelVehicles.id, IDS.truckBio))
    try {
      await submitRepuestoRequest({ requestId, userId: IDS.jefe })
    } finally {
      await testDb.update(schema.fuelVehicles).set({ isActive: true }).where(eq(schema.fuelVehicles.id, IDS.truckBio))
    }
    expect(await requestStatus(requestId)).toBe("submitted")
    expect((await savedItems(requestId))[0]).toMatchObject({ vehicleId: null, status: "requested" })
    expect((await itemRow(note.itemIds[0]!)).chargeVehicleId).toBe(IDS.truckBio)
  })
})

describe("al enviar la solicitud se revalida la nota", () => {
  const closedNote = (status: string) => testDb.update(schema.mantPartsNotes).set(
    status === "anulada" ? { status, voidedAt: NOW, voidedByUserId: IDS.jefe, voidReason: "Se pidió por error" }
      : status === "en_espera" ? { status, holdReason: "Esperando una cotización" } : { status },
  )

  it.each([
    ["anulada", "fue anulada: quita ese ítem de la solicitud"],
    ["en_espera", "está en espera: jefatura debe aceptarla antes de comprar"],
    ["cerrada", "está cerrada: ya no se compra con ella"],
    ["rechazada", "está rechazada: ya no se compra con ella"],
  ])("con la nota %s el envío se frena y la solicitud sigue en borrador", async (status, expected) => {
    const note = await manualNote([{ description: "Manguera hidráulica", chargeVehicleId: IDS.truckBio }])
    const requestId = await persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }]))
    await closedNote(status).where(eq(schema.mantPartsNotes.id, note.noteId))

    // Autoguardar sigue funcionando (el ítem se conserva); es el envío el que lo frena.
    await persistRepuestoDraft(buyer(), draft([{ partsNoteItemId: note.itemIds[0] }], { id: requestId }))
    expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe }))).toContain(expected)
    expect(await requestStatus(requestId)).toBe("draft")
  })

  it("con la línea rechazada o sacada de stock después de guardar el borrador, el envío se frena", async () => {
    const note = await manualNote([{ description: "Manguera hidráulica" }, { description: "Abrazadera" }])
    const requestId = await persistRepuestoDraft(buyer(), draft([
      { partsNoteItemId: note.itemIds[0] },
      { partsNoteItemId: note.itemIds[1], description: "Abrazadera" },
    ]))
    // Jefatura la rechaza a mano (la línea pasa de «en compra» a «rechazada»).
    await testDb.update(schema.mantPartsNoteItems).set({ resolution: "rechazada", resolutionReason: "Ya no hace falta", resolvedByUserId: IDS.jefe, resolvedAt: NOW })
      .where(eq(schema.mantPartsNoteItems.id, note.itemIds[1]!))
    expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe }))).toMatch(/«Abrazadera».*fue rechazada: quita ese ítem/)
    expect(await requestStatus(requestId)).toBe("draft")
  })
})

describe("aviso al autor cuando lo comprado llega a la faena (nota sin OT)", () => {
  /** Una compra de la línea, con su OC lista para recibirse en faena. */
  async function bought(quantity: number, authorId: string = IDS.jefe) {
    const product = await makeProduct(`Filtro ${crypto.randomUUID().slice(0, 6)}`)
    const note = await manualNote([{ description: "Filtro de aceite", quantity, productId: product }], authorId)
    const request = await requestFor(note.itemIds[0]!, "purchased")
    await link(note.itemIds[0]!, request.itemId)
    const order = await orderFor(request.itemId, product, quantity)
    return { note, order }
  }
  const receive = (orderId: string, ocItemId: string, quantity: number) => registerReceipt({
    purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio, items: [{ purchaseOrderItemId: ocItemId, quantityReceived: quantity }],
  })

  it("la recepción parcial no avisa; la que completa avisa al autor, una vez, con el enlace a su nota", async () => {
    const { note, order } = await bought(3)
    await receive(order.orderId, order.ocItemId, 1)
    await vi.waitFor(async () => expect(await noteRow(note.noteId)).toMatchObject({ status: "recibida_parcial" }))
    expect(await arrivalNotices()).toHaveLength(0)

    const receiptId = await receive(order.orderId, order.ocItemId, 2)
    await vi.waitFor(async () => expect(await arrivalNotices()).toHaveLength(1))
    const [notice] = await arrivalNotices()
    expect(notice).toMatchObject({
      userId: IDS.jefe, entityType: "mant_parts_note", entityId: note.noteId, entityHref: `/mantencion/notas-pedido/${note.noteId}`,
      dedupeKey: `mant-np-arrived:${note.noteId}:${receiptId}`,
    })
    expect(notice!.title).toBe(`Llegó a faena: Filtro de aceite · ${note.code}`)
    expect(notice!.body).toContain("Ya está en la bodega de la faena")
    expect(await expectInvariant(note.noteId)).toBe("cerrada")

    // Idempotente: avisar otra vez por la misma recepción no repite nada.
    const [item] = await testDb.select({ id: schema.purchaseRequestItems.id }).from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.partsNoteItemId, note.itemIds[0]!))
    await notifyPartsNoteLinesArrived({ receiptId, actorUserId: IDS.mecBio, requestItemIds: [item!.id] })
    expect(await arrivalNotices()).toHaveLength(1)
  })

  it("no se avisa a quien recibe ni a una nota importada (sin autor): sólo llega el aviso de control", async () => {
    // Quien recibe es el autor de la nota: no se avisa a sí mismo.
    const own = await bought(1, IDS.mecBio)
    await receive(own.order.orderId, own.order.ocItemId, 1)
    // Una nota importada: sin usuario autor, no hay a quién avisar.
    const imported = await bought(1)
    await testDb.update(schema.mantPartsNotes).set({ requestedByUserId: null, requestedByName: "Taller Biodiversa", externalRef: "CHOME-4242" }).where(eq(schema.mantPartsNotes.id, imported.note.noteId))
    await receive(imported.order.orderId, imported.order.ocItemId, 1)
    // Control: una nota de otra persona sí avisa. Los avisos salen en orden: si llegó éste, los anteriores ya tuvieron su oportunidad.
    const control = await bought(1)
    await receive(control.order.orderId, control.order.ocItemId, 1)
    await vi.waitFor(async () => expect(await arrivalNotices()).toHaveLength(1))
    expect((await arrivalNotices())[0]).toMatchObject({ userId: IDS.jefe, entityId: control.note.noteId })
    expect((await noteRow(own.note.noteId)).status).toBe("cerrada")
    expect((await noteRow(imported.note.noteId)).status).toBe("cerrada")
  })

  it("también avisa cuando el cotejo de la guía deja completa la compra (vía oficina), una vez por recepción", async () => {
    const product = await makeProduct("Sello de pistón")
    const note = await manualNote([{ description: "Sello de pistón", quantity: 2, productId: product }])
    const request = await requestFor(note.itemIds[0]!, "purchased")
    await link(note.itemIds[0]!, request.itemId)
    // Una OC vía oficina: llega a la oficina, viaja en guía y llega a la faena con el cotejo.
    const orderId = "oc-np-oficina"
    const ocItemId = "ocitem-np-oficina"
    await testDb.insert(schema.purchaseOrders).values({
      id: orderId, code: "OC-NP-OFI", worksiteId: IDS.wsBio, supplierId: "sup-tr", createdBy: IDS.jefe, status: "sent", deliveryMode: "via_oficina", createdAt: NOW, updatedAt: NOW,
    })
    await testDb.insert(schema.purchaseOrderItems).values({ id: ocItemId, purchaseOrderId: orderId, requestItemId: request.itemId, productId: product, quantity: 2, unitOfMeasure: "unidad", sortOrder: 0 })
    const officeReceipt = await registerReceipt({ purchaseOrderId: orderId, receivedBy: IDS.jefe, stage: "office", items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 2 }] })
    const [guide] = await testDb.select().from(schema.dispatchGuides).where(eq(schema.dispatchGuides.receiptId, officeReceipt))
    await dispatchDispatchGuide(guide!.id, { userId: IDS.jefe, userEmail: "jefe@chome.test" })
    const [guideLine] = await testDb.select().from(schema.dispatchGuideItems).where(eq(schema.dispatchGuideItems.guideId, guide!.id))
    // Hasta el cotejo no llegó a la faena: no hay aviso.
    expect(await arrivalNotices()).toHaveLength(0)

    await confirmDispatchGuideReceipt(guide!.id, { items: [{ guideItemId: guideLine!.id, quantityReceived: 2 }] }, { userId: IDS.mecBio, userEmail: "mec@chome.test" })
    await vi.waitFor(async () => expect(await arrivalNotices()).toHaveLength(1))
    const [notice] = await arrivalNotices()
    expect(notice).toMatchObject({ userId: IDS.jefe, entityId: note.noteId })
    expect(notice!.dedupeKey).toMatch(new RegExp(`^mant-np-arrived:${note.noteId}:`))
    expect(await expectInvariant(note.noteId)).toBe("cerrada")
  })
})
