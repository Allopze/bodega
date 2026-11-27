import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import {
  IDS,
  contextOf,
  expectInvariant,
  itemRow,
  makeProduct,
  manualNote,
  phoneNote,
  createPartsNoteFromDevice,
  resetState,
  setupDatabase,
  testDb,
  itemsOf,
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

/** Permite hacer fallar el envío o la aprobación a propósito; sin eso, el servicio de solicitudes es el de verdad. */
const hooks = vi.hoisted(() => ({ failSubmit: null as Error | null, failApprove: null as Error | null }))
vi.mock("@/lib/services/repuestos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/repuestos")>()
  return {
    ...real,
    submitRepuestoRequest: (input: Parameters<typeof real.submitRepuestoRequest>[0]) => {
      if (hooks.failSubmit) return Promise.reject(hooks.failSubmit)
      return real.submitRepuestoRequest(input)
    },
    approveRepuestoWithoutQuotation: (input: Parameters<typeof real.approveRepuestoWithoutQuotation>[0]) => {
      if (hooks.failApprove) return Promise.reject(hooks.failApprove)
      return real.approveRepuestoWithoutQuotation(input)
    },
  }
})

const realServices = await vi.importActual<typeof import("@/lib/services/repuestos")>("@/lib/services/repuestos")
const { sendPartsNoteLinesToPurchase, NoLinesToSendError } = await import("@/lib/services/mantencion/parts-notes/send-to-purchase")
const { acceptPartsNote, holdPartsNote } = await import("@/lib/services/mantencion/parts-notes/transitions")
const { pendingPurchaseWhere } = await import("@/lib/adquisiciones/pending-purchase")

/**
 * «Aceptar la nota = aprobar su compra» (ADR 0001, D30 a D32) de punta a punta contra Postgres: la solicitud de repuestos
 * que sale de las líneas pendientes de UNA nota (borrador → envío → aprobación sin cotización, `roleContext`
 * `mantencion_np`), aprobada SIEMPRE (D31: una nota nace sin precio y Compras le pregunta al proveedor; ni el umbral de
 * $200.000 ni la falta de precio la frenan), el alcance y el permiso, y lo que pasa cuando el envío o la aprobación fallan.
 */

const jefe = async (permissions?: (current: string[]) => string[], scope?: { worksiteIds: string[]; isGlobal: boolean }): Promise<Session> => {
  const context = await contextOf(IDS.jefe, permissions)
  return {
    user: {
      id: context.viewer.userId, email: context.viewer.email, name: context.userName, roles: [],
      permissions: [...context.viewer.permissions, "repuestos:create"],
      worksiteIds: scope?.worksiteIds ?? [...context.viewer.worksiteIds], isGlobal: scope?.isGlobal ?? context.viewer.isGlobal,
    },
  } as unknown as Session
}

const OT_VEHICLE = IDS.truckBio

/** Repuesto de catálogo con precio de referencia: es de donde sale el precio estimado que la regla de cotización mira. */
async function pricedProduct(name: string, price: number | null): Promise<string> {
  const id = await makeProduct(name)
  if (price !== null) await testDb.update(schema.products).set({ referencePrice: price }).where(eq(schema.products.id, id))
  return id
}

type Line = { description: string; quantity?: number; productId?: string | null }

/** Una nota CON OT, como la manda el mecánico desde el teléfono. */
async function otNote(lines: Line[], extra: { equipmentStopped?: boolean } = {}) {
  const result = await createPartsNoteFromDevice(phoneNote({
    equipmentStopped: extra.equipmentStopped ?? false,
    lines: lines.map((line) => ({ description: line.description, quantity: line.quantity ?? 2, unitOfMeasure: "unidad", partNumber: null, productId: line.productId ?? null })),
  }), await contextOf(IDS.mecBio))
  if (result.status !== 200 || !result.body.ok) throw new Error("no se pudo crear la nota con OT")
  return { noteId: result.body.noteId, code: result.body.code, itemIds: await itemsOf(result.body.noteId) }
}

const requestsOf = () => testDb.select().from(schema.purchaseRequests)
const itemsOfRequest = (requestId: string) => testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
const decisionsOf = (requestId: string) => testDb.select().from(schema.approvalDecisions).where(eq(schema.approvalDecisions.requestId, requestId))
const inPurchaseQueue = async () => (await testDb
  .select({ id: schema.purchaseRequestItems.id })
  .from(schema.purchaseRequestItems)
  .innerJoin(schema.purchaseRequests, eq(schema.purchaseRequests.id, schema.purchaseRequestItems.requestId))
  .where(pendingPurchaseWhere())).map((row) => row.id)

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("Se esperaba que la operación fuera rechazada")
}

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(async () => {
  hooks.failSubmit = null
  hooks.failApprove = null
  // Las decisiones de aprobación cuelgan de los ítems de solicitud: `resetState` no las conoce.
  await testDb.delete(schema.approvalDecisions)
  await resetState()
})

describe("aceptar y enviar a compra", () => {
  it("una nota con OT: acepta, sale UNA solicitud aprobada y sus ítems caen en la cola de Compras", async () => {
    const filter = await pricedProduct("Filtro de aceite", 10_000)
    const oil = await pricedProduct("Aceite hidráulico", 25_000)
    const note = await otNote([{ description: "Filtro de aceite", productId: filter }, { description: "Aceite hidráulico", productId: oil }])
    const session = await jefe()

    expect((await acceptPartsNote((await contextOf(IDS.jefe)).viewer, { noteId: note.noteId })).ok).toBe(true)
    expect(await expectInvariant(note.noteId)).toBe("aceptada")

    const result = await sendPartsNoteLinesToPurchase(session, { noteId: note.noteId, origin: "aceptar" })
    expect(result).toMatchObject({ approved: true, lineCount: 2 })
    expect(result.message).toBe(`2 líneas a Compras (${result.requestCode}).`)

    const [request] = await requestsOf()
    expect(request).toMatchObject({ id: result.requestId, requestType: "repuestos", status: "approved", requesterId: IDS.jefe, worksiteId: IDS.wsBio })
    expect(request!.notes).toBe(`Nota de pedido ${note.code} aceptada por Alexis Morales`)
    const items = await itemsOfRequest(result.requestId)
    expect(items.map((item) => item.status)).toEqual(["approved", "approved"])
    expect(items.map((item) => item.partsNoteItemId).sort()).toEqual([...note.itemIds].sort())
    expect(items.every((item) => item.vehicleId === OT_VEHICLE && item.workOrderId !== null)).toBe(true)

    const [decision] = await decisionsOf(result.requestId)
    expect(decision).toMatchObject({ type: "approve", decidedBy: IDS.jefe, roleContext: "mantencion_np" })
    expect(decision!.reason).toBe(`Aprobada al enviar a compra la nota de pedido ${note.code}`)
    expect((await decisionsOf(result.requestId)).length).toBe(2)

    expect((await inPurchaseQueue()).sort()).toEqual(items.map((item) => item.id).sort())
    expect((await Promise.all(note.itemIds.map((id) => itemRow(id)))).map((row) => row.resolution)).toEqual(["en_compra", "en_compra"])
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
  })

  it("una nota sin OT bajo el umbral: la solicitud sale sin OT, con el equipo de cargo de la línea, aprobada", async () => {
    const filter = await pricedProduct("Filtro de aceite", 10_000)
    const note = await manualNote([{ description: "Filtro de aceite", quantity: 3, productId: filter, chargeVehicleId: OT_VEHICLE }])

    const result = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    expect(result).toMatchObject({ approved: true, lineCount: 1 })
    const [item] = await itemsOfRequest(result.requestId)
    expect(item).toMatchObject({ status: "approved", workOrderId: null, vehicleId: OT_VEHICLE, partsNoteItemId: note.itemIds[0], estimatedUnitPrice: 10_000 })
    expect(await inPurchaseQueue()).toEqual([item!.id])
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
  })

  it("una nota sin OT sobre el umbral de cotización: la regla no se evalúa, sale aprobada y cae en la cola de Compras", async () => {
    const motor = await pricedProduct("Motor de arranque", 150_000)
    const note = await manualNote([{ description: "Motor de arranque", quantity: 2, productId: motor }])

    const result = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    expect(result).toMatchObject({ approved: true, lineCount: 1 })
    expect(result).not.toHaveProperty("needsQuotation")
    const [item] = await itemsOfRequest(result.requestId)
    expect(item).toMatchObject({ status: "approved", estimatedUnitPrice: 150_000 })
    expect((await requestsOf())[0]).toMatchObject({ id: result.requestId, status: "approved" })
    expect(await inPurchaseQueue()).toEqual([item!.id])
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
  })

  it("sin ningún precio (línea de texto libre) y sin OT sale aprobada igual: Compras pregunta al proveedor y compra", async () => {
    const note = await manualNote([{ description: "Abrazadera de 2 pulgadas" }])
    const result = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    expect(result).toMatchObject({ approved: true, lineCount: 1 })
    expect(result.message).toBe(`1 línea a Compras (${result.requestCode}).`)
    const [item] = await itemsOfRequest(result.requestId)
    expect(item).toMatchObject({ status: "approved", estimatedUnitPrice: null, workOrderId: null, vehicleId: null })
    expect(await inPurchaseQueue()).toEqual([item!.id])
    expect(await decisionsOf(result.requestId)).toMatchObject([{ type: "approve", roleContext: "mantencion_np" }])
  })

  it("con OT y sin ningún precio también sale aprobada, con la OT y el equipo de la nota", async () => {
    const note = await otNote([{ description: "Abrazadera de 2 pulgadas" }])
    const result = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    expect(result).toMatchObject({ approved: true, lineCount: 1 })
    const [item] = await itemsOfRequest(result.requestId)
    expect(item).toMatchObject({ status: "approved", vehicleId: OT_VEHICLE, estimatedUnitPrice: null })
    expect(item!.workOrderId).not.toBeNull()
    expect(await inPurchaseQueue()).toEqual([item!.id])
  })

  it("lineIds envía sólo esas líneas; las demás siguen pendientes y se envían después (una solicitud por envío)", async () => {
    const a = await pricedProduct("Filtro A", 5_000)
    const b = await pricedProduct("Filtro B", 6_000)
    const note = await manualNote([{ description: "Filtro A", productId: a }, { description: "Filtro B", productId: b }])
    const first = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, lineIds: [note.itemIds[1]!] })
    expect(first.lineCount).toBe(1)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect((await itemRow(note.itemIds[1]!)).resolution).toBe("en_compra")
    expect(await expectInvariant(note.noteId)).toBe("en_gestion")

    const second = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    expect(second.lineCount).toBe(1)
    expect(second.requestId).not.toBe(first.requestId)
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
  })

  it("una línea elegida que ya no está pendiente frena el envío entero, sin dejar nada a medias", async () => {
    const a = await pricedProduct("Filtro A", 5_000)
    const note = await manualNote([{ description: "Filtro A", productId: a }, { description: "Filtro B" }])
    await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, lineIds: [note.itemIds[0]!] })
    const before = (await requestsOf()).length
    expect(await message(async () => sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, lineIds: [note.itemIds[0]!, note.itemIds[1]!] })))
      .toMatch(/Una de las líneas ya no está pendiente en la nota NP-/)
    expect((await requestsOf()).length).toBe(before)
    expect((await itemRow(note.itemIds[1]!)).resolution).toBe("pendiente")
    expect(await message(async () => sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, lineIds: [] }))).toBe("Elige al menos una línea para enviar a compra.")
  })

  it("una nota sin líneas pendientes lo dice con el error propio (no es un fallo para quien acepta)", async () => {
    const a = await pricedProduct("Filtro A", 5_000)
    const note = await manualNote([{ description: "Filtro A", productId: a }])
    await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    await expect(sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })).rejects.toBeInstanceOf(NoLinesToSendError)
  })
})

describe("quién puede y qué se rechaza", () => {
  it("sin mant:np:manage no se envía nada a compra (mant:np:purchase compra a mano, desde «Comprar»)", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const session = await jefe((current) => [...current.filter((p) => p !== "mant:np:manage"), "mant:np:purchase"])
    expect(await message(() => sendPartsNoteLinesToPurchase(session, { noteId: note.noteId }))).toBe("No tienes permiso para enviar notas de pedido a compra.")
    expect(await requestsOf()).toEqual([])
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
  })

  it("una nota de otra faena está fuera de alcance: se rechaza sin crear solicitud", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const session = await jefe(undefined, { worksiteIds: [IDS.wsCho], isGlobal: false })
    expect(await message(() => sendPartsNoteLinesToPurchase(session, { noteId: note.noteId }))).toBe("Esta nota de pedido es de una faena que no es de tu alcance.")
    expect(await requestsOf()).toEqual([])
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
  })

  it("una nota en espera no se compra hasta aceptarla, y una que no existe se dice", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const viewer = (await contextOf(IDS.jefe)).viewer
    expect((await holdPartsNote(viewer, { noteId: note.noteId, reason: "Falta confirmar el equipo" })).ok).toBe(true)
    expect(await message(async () => sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId }))).toBe("La nota está en espera: acéptala primero.")
    expect(await message(async () => sendPartsNoteLinesToPurchase(await jefe(), { noteId: "no-existe" }))).toBe("Esa nota de pedido ya no existe.")
    expect(await requestsOf()).toEqual([])
  })
})

describe("cuando el envío o la aprobación fallan", () => {
  it("un fallo del envío que no es de cotización borra el borrador, las líneas vuelven a pendiente y el error se propaga", async () => {
    const filter = await pricedProduct("Filtro de aceite", 10_000)
    const note = await manualNote([{ description: "Filtro de aceite", productId: filter }])
    hooks.failSubmit = new Error("La OT ya no está abierta")
    expect(await message(async () => sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId }))).toBe("La OT ya no está abierta")
    expect(await requestsOf()).toEqual([])
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect(await expectInvariant(note.noteId)).toBe("enviada")

    // Y se puede volver a intentar: nada quedó trabado.
    hooks.failSubmit = null
    expect(await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })).toMatchObject({ approved: true })
  })

  it("si la aprobación falla, la solicitud ya está enviada: queda esperando en Aprobaciones y el resultado lo dice", async () => {
    const filter = await pricedProduct("Filtro de aceite", 10_000)
    const note = await manualNote([{ description: "Filtro de aceite", productId: filter }])
    hooks.failApprove = new Error("No tienes acceso a esta faena")
    const result = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })
    expect(result).toMatchObject({ approved: false, lineCount: 1 })
    expect(result.message).toBe(`La solicitud ${result.requestCode} quedó enviada a aprobación: No tienes acceso a esta faena.`)
    const [request] = await requestsOf()
    expect(request).toMatchObject({ id: result.requestId, status: "submitted" })
    expect(await inPurchaseQueue()).toEqual([])
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
    expect(await decisionsOf(result.requestId)).toEqual([])
  })
})

describe("la regla de cotización sigue rigiendo fuera de la aceptación de una nota", () => {
  const { submitRepuestoRequest, persistRepuestoDraft } = realServices

  it("una solicitud manual normal, sin líneas de nota, sigue exigiendo la cotización sobre el umbral", async () => {
    const requestId = await persistRepuestoDraft(await jefe(), {
      worksiteId: IDS.wsBio, urgency: "high", requiredDate: "2099-12-01", justification: null,
      items: [{ description: "Motor de arranque", quantity: 2, unitOfMeasure: "unidad", estimatedUnitPrice: 150_000 }],
    })
    expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe }))).toBe("Sobre $200.000 se necesita al menos una cotización adjunta.")
    // Ni siquiera la opción interna la salta: no compra ninguna línea de nota.
    expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe, partsNoteAcceptance: true }))).toBe("Sobre $200.000 se necesita al menos una cotización adjunta.")
    expect((await requestsOf())[0]).toMatchObject({ id: requestId, status: "draft" })
  })

  it("la opción sólo vale si TODOS los ítems compran una línea de nota: un ítem suelto mantiene la regla", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const requestId = await persistRepuestoDraft(await jefe(), {
      worksiteId: IDS.wsBio, urgency: "high", requiredDate: "2099-12-01", justification: null,
      items: [
        { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partsNoteItemId: note.itemIds[0]!, estimatedUnitPrice: 1_000 },
        { description: "Motor de arranque", quantity: 2, unitOfMeasure: "unidad", estimatedUnitPrice: 150_000 },
      ],
    })
    expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe, partsNoteAcceptance: true }))).toBe("Sobre $200.000 se necesita al menos una cotización adjunta.")
    expect((await requestsOf())[0]!.status).toBe("draft")
  })
})
