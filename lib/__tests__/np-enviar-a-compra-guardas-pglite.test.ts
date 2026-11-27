import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"
import { todayInChile } from "@/lib/utils"
import {
  IDS,
  SNAPSHOT,
  contextOf,
  createPartsNoteFromDevice,
  expectInvariant,
  itemRow,
  itemsOf,
  makeProduct,
  manualNote,
  phoneNote,
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

/** Hace fallar la aprobación a propósito; sin eso el servicio de solicitudes es el de verdad. */
const hooks = vi.hoisted(() => ({ failApprove: null as Error | null }))
vi.mock("@/lib/services/repuestos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/repuestos")>()
  return {
    ...real,
    approveRepuestoWithoutQuotation: (input: Parameters<typeof real.approveRepuestoWithoutQuotation>[0]) => {
      if (hooks.failApprove) return Promise.reject(hooks.failApprove)
      return real.approveRepuestoWithoutQuotation(input)
    },
  }
})

/** Quién recibe los avisos de «solicitud nueva»: un aprobador de mentira, sin sembrar roles de compras. */
const notices = vi.hoisted(() => ({ sent: [] as Array<{ userIds: string[]; payload: Record<string, unknown> }> }))
vi.mock("@/lib/services/notifications", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/notifications")>()
  return {
    ...real,
    getUserIdsWithPermission: async () => ["u-aprobador"],
    notifyManyUser: async (userIds: string[], payload: Record<string, unknown>) => { notices.sent.push({ userIds, payload }) },
  }
})

const { persistRepuestoDraft, submitRepuestoRequest } = await import("@/lib/services/repuestos")
const { sendPartsNoteLinesToPurchase, NoLinesToSendError } = await import("@/lib/services/mantencion/parts-notes/send-to-purchase")
const { transferVehiclesTx } = await import("@/lib/services/fleet-transfers")

/**
 * Las guardas de «enviar a compra» (ADR 0001, D30 a D32) contra Postgres de verdad: la solicitud nace en una faena del alcance de
 * quien envía (aunque el equipo de la nota se haya trasladado), una línea no se compra dos veces (al guardar NI al enviar, y
 * comprar en partes sigue permitido), la auditoría deja que la regla de cotización se omitió, la justificación dice de dónde viene
 * el envío y, si la aprobación automática falla, se avisa a quienes aprueban.
 */

const jefe = async (scope?: { worksiteIds: string[]; isGlobal: boolean }): Promise<Session> => {
  const context = await contextOf(IDS.jefe)
  return {
    user: {
      id: context.viewer.userId, email: context.viewer.email, name: context.userName, roles: [],
      permissions: [...context.viewer.permissions, "repuestos:create"],
      worksiteIds: scope?.worksiteIds ?? [...context.viewer.worksiteIds], isGlobal: scope?.isGlobal ?? context.viewer.isGlobal,
    },
  } as unknown as Session
}

const draft = (items: Array<Record<string, unknown>>) => ({
  worksiteId: IDS.wsBio, urgency: "high" as const, requiredDate: "2099-12-01", justification: null,
  items: items.map((item) => ({ description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", ...item })),
})

const requestsOf = () => testDb.select().from(schema.purchaseRequests)
const codeOf = async (requestId: string) => (await testDb.select({ code: schema.purchaseRequests.code }).from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, requestId)))[0]!.code
const submittedAudit = async (requestId: string) => (await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, requestId)))
  .map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>)
  .filter((state) => state.status === "submitted")

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
  hooks.failApprove = null
  notices.sent.length = 0
  await testDb.delete(schema.approvalDecisions)
  await resetState()
})

describe("doble compra", () => {
  it("una solicitud guardada DESPUÉS de que la nota se envió a compra no puede comprar otra vez la misma línea", async () => {
    const note = await manualNote([{ description: "Filtro de aceite", quantity: 2 }])
    const sent = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, origin: "lineas" })

    // Un formulario manual que se abrió antes y se guarda ahora.
    expect(await message(async () => persistRepuestoDraft(await jefe(), draft([{ partsNoteItemId: note.itemIds[0] }]))))
      .toBe(`La línea «Filtro de aceite» de ${note.code} ya se está comprando en ${sent.requestCode}: quita ese ítem de la solicitud.`)
    // El guardado se deshizo entero: sólo queda la solicitud que salió de la nota.
    expect((await requestsOf()).map((request) => request.id)).toEqual([sent.requestId])
    // Y enviar otra vez desde la nota tampoco duplica nada.
    await expect(sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, origin: "lineas" })).rejects.toBeInstanceOf(NoLinesToSendError)
    expect(await requestsOf()).toHaveLength(1)
  })

  it("un borrador manual guardado antes frena el envío desde la nota, y si otra solicitud cubrió la línea entretanto, frena su propio envío", async () => {
    const note = await manualNote([{ description: "Filtro de aceite", quantity: 2 }])
    const requestId = await persistRepuestoDraft(await jefe(), draft([{ partsNoteItemId: note.itemIds[0], estimatedUnitPrice: 10_000 }]))
    await expect(sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId })).rejects.toBeInstanceOf(NoLinesToSendError)

    // Otra solicitud pasa a comprar la línea (un borrador de antes de esta regla, por ejemplo).
    const other = await requestFor(note.itemIds[0]!)
    const otherCode = await codeOf(other.requestId)
    expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe })))
      .toBe(`La línea «Filtro de aceite» de ${note.code} ya se está comprando en ${otherCode}: quita ese ítem de la solicitud.`)
    expect((await testDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, requestId)))[0]!.status).toBe("draft")
  })

  it("comprar en partes sigue permitido mientras lo vivo no cubra la cantidad pedida", async () => {
    const note = await manualNote([{ description: "Filtro de aceite", quantity: 2 }])
    const part = async () => persistRepuestoDraft(await jefe(), draft([{ partsNoteItemId: note.itemIds[0], quantity: 1 }]))
    await part()
    await part()
    expect(await message(part)).toMatch(/^La línea «Filtro de aceite» de NP-.* ya se está comprando en REP-.*: quita ese ítem de la solicitud\.$/)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
  })
})

describe("auditoría, aviso y justificación", () => {
  it("el envío que omite la regla de cotización lo deja en la auditoría; el de una solicitud normal, no", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const sent = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, origin: "aceptar" })
    expect(await submittedAudit(sent.requestId)).toEqual([{ status: "submitted", quotationCount: 0, quotationRuleSkipped: true }])

    const manualId = await persistRepuestoDraft(await jefe(), draft([{ description: "Abrazadera", estimatedUnitPrice: 10_000 }]))
    await submitRepuestoRequest({ requestId: manualId, userId: IDS.jefe })
    expect(await submittedAudit(manualId)).toEqual([{ status: "submitted", quotationCount: 0 }])
  })

  it("la justificación dice «aceptada» sólo al aceptar; por línea o en lote dice «enviada a compra»", async () => {
    const accepted = await manualNote([{ description: "Filtro de aceite" }])
    const byLine = await manualNote([{ description: "Sello de bomba" }])
    const first = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: accepted.noteId, origin: "aceptar" })
    const second = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: byLine.noteId, origin: "lineas" })
    const notes = new Map((await requestsOf()).map((request) => [request.id, request.notes]))
    expect(notes.get(first.requestId)).toBe(`Nota de pedido ${accepted.code} aceptada por Alexis Morales`)
    expect(notes.get(second.requestId)).toBe(`Nota de pedido ${byLine.code} enviada a compra por Alexis Morales`)
    // Sin origen no se afirma que alguien aceptó la nota.
    const third = await manualNote([{ description: "Abrazadera" }])
    const sent = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: third.noteId })
    expect((await requestsOf()).find((request) => request.id === sent.requestId)!.notes).toBe(`Nota de pedido ${third.code} enviada a compra por Alexis Morales`)
  })

  it("si la aprobación automática falla, se avisa a quienes aprueban repuestos (una vez, con el enlace a la solicitud)", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    hooks.failApprove = new Error("No tienes acceso a esta faena")
    const result = await sendPartsNoteLinesToPurchase(await jefe(), { noteId: note.noteId, origin: "aceptar" })
    expect(result.approved).toBe(false)
    await vi.waitFor(() => expect(notices.sent).toHaveLength(1))
    expect(notices.sent[0]).toMatchObject({
      userIds: ["u-aprobador"],
      payload: { type: "request_submitted", title: `Nueva solicitud: ${result.requestCode}`, entityType: "purchase_request", entityId: result.requestId, entityHref: `/solicitudes/${result.requestId}` },
    })
    // Aprobada de verdad, nadie tiene nada que aprobar: no hay aviso.
    hooks.failApprove = null
    notices.sent.length = 0
    const other = await manualNote([{ description: "Sello de bomba" }])
    expect((await sendPartsNoteLinesToPurchase(await jefe(), { noteId: other.noteId, origin: "aceptar" })).approved).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(notices.sent).toEqual([])
  })
})

describe("la faena de la solicitud tiene que ser del alcance de quien envía", () => {
  const OT = "ot-guardas-1"

  it("nota con OT en A y el equipo hoy en B: quien sólo tiene A no envía a compra, no queda solicitud colgada; un rol global sí", async () => {
    await testDb.insert(schema.mantWorkOrders).values({
      id: OT, folio: "OT-GU-1", vehicleId: IDS.machineBio, worksiteId: IDS.wsBio, equipmentSnapshot: { ...SNAPSHOT, code: "MQ-01", worksite: "Biodiversa" },
      repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
      repairDescription: "Cadena floja", status: "en_ejecucion", assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
      workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
    })
    const created = await createPartsNoteFromDevice(phoneNote({ workOrderId: OT, lines: [{ description: "Cadena de oruga", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null }] }), await contextOf(IDS.mecBio))
    if (created.status !== 200 || !created.body.ok) throw new Error("no se pudo crear la nota con OT")
    const noteId = created.body.noteId
    const lineIds = await itemsOf(noteId)

    const today = todayInChile()
    const transfer = await testDb.transaction((tx) => transferVehiclesTx(
      tx as unknown as Tx,
      { userId: IDS.jefe, email: "jefe@chome.test", scope: "all" },
      { toWorksiteId: IDS.wsCho, effectiveDate: today, reason: "Refuerzo de la faena Cholguán", authorizedBy: "Gerencia", vehicleIds: [IDS.machineBio] },
      today,
    ))
    expect(transfer.ok).toBe(true)

    const onlyBio = await jefe({ worksiteIds: [IDS.wsBio], isGlobal: false })
    expect(await message(() => sendPartsNoteLinesToPurchase(onlyBio, { noteId })))
      .toBe("El equipo de esta nota está hoy en Cholguán, que no es de tu alcance: pide a quien la gestiona allí que la envíe a compra.")
    expect(await requestsOf()).toEqual([])
    expect((await itemRow(lineIds[0]!)).resolution).toBe("pendiente")
    expect(await expectInvariant(noteId)).toBe("enviada")

    const global = await sendPartsNoteLinesToPurchase(await jefe({ worksiteIds: [], isGlobal: true }), { noteId, origin: "aceptar" })
    expect(global.approved).toBe(true)
    expect((await requestsOf())[0]).toMatchObject({ id: global.requestId, worksiteId: IDS.wsCho })
  })

  it("una nota sin OT cuya faena no es del alcance tampoco se envía", async () => {
    const product = await makeProduct("Filtro de aceite")
    const note = await manualNote([{ description: "Filtro de aceite", productId: product }])
    const onlyCho = await jefe({ worksiteIds: [IDS.wsCho], isGlobal: false })
    expect(await message(() => sendPartsNoteLinesToPurchase(onlyCho, { noteId: note.noteId }))).toBe("Esta nota de pedido es de una faena que no es de tu alcance.")
    expect(await requestsOf()).toEqual([])
  })
})
