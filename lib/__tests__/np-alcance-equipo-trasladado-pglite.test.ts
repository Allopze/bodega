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
  manualNote,
  phoneNote,
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

const { persistRepuestoDraft } = await import("@/lib/services/repuestos")
const { sendPartsNoteLinesToPurchase } = await import("@/lib/services/mantencion/parts-notes/send-to-purchase")
const { loadPartsNotePrefill } = await import("@/lib/services/mantencion/parts-notes/prefill")
const { transferVehiclesTx } = await import("@/lib/services/fleet-transfers")
const { viewerFromSession } = await import("@/lib/services/mantencion/access")

/**
 * El alcance de una nota de pedido es el mismo en los tres sitios donde se decide (`assertCanManage`, `loadPartsNotePrefill`
 * y `assertPartsNoteLineBuyable`): la faena de la nota O la faena ACTUAL de su equipo. Quien gestiona una nota sólo porque el
 * equipo de su OT fue trasladado a su faena no recibe «La línea de la nota de pedido ya no existe» al comprarla; una nota de
 * otra faena sin relación con la suya sigue informándose como inexistente.
 */

const OT = "ot-alcance-1"

const sessionIn = async (worksiteIds: string[]): Promise<Session> => {
  const context = await contextOf(IDS.jefe)
  return {
    user: {
      id: context.viewer.userId, email: context.viewer.email, name: context.userName, roles: [],
      permissions: [...context.viewer.permissions, "repuestos:create"], worksiteIds, isGlobal: false,
    },
  } as unknown as Session
}

const draft = (worksiteId: string, items: Array<Record<string, unknown>>) => ({
  worksiteId, urgency: "high" as const, requiredDate: "2099-12-01", justification: null,
  items: items.map((item) => ({ description: "Cadena de oruga", quantity: 1, unitOfMeasure: "unidad", ...item })),
})

const requestsOf = () => testDb.select().from(schema.purchaseRequests)

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("Se esperaba que la operación fuera rechazada")
}

/** Una nota con OT de Biodiversa (equipo MQ-01), creada desde el teléfono del mecánico. */
async function noteWithOrder() {
  const created = await createPartsNoteFromDevice(
    phoneNote({ workOrderId: OT, lines: [{ description: "Cadena de oruga", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null }] }),
    await contextOf(IDS.mecBio),
  )
  if (created.status !== 200 || !created.body.ok) throw new Error("no se pudo crear la nota con OT")
  return { noteId: created.body.noteId, lineIds: await itemsOf(created.body.noteId) }
}

beforeAll(async () => {
  await setupDatabase()
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT, folio: "OT-AL-1", vehicleId: IDS.machineBio, worksiteId: IDS.wsBio, equipmentSnapshot: { ...SNAPSHOT, code: "MQ-01", worksite: "Biodiversa" },
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Cadena floja", status: "en_ejecucion", assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
  })
  // El equipo de la OT se traslada de Biodiversa a Cholguán: la nota queda en Biodiversa, el equipo está hoy en Cholguán.
  const today = todayInChile()
  const transfer = await testDb.transaction((tx) => transferVehiclesTx(
    tx as unknown as Tx,
    { userId: IDS.jefe, email: "jefe@chome.test", scope: "all" },
    { toWorksiteId: IDS.wsCho, effectiveDate: today, reason: "Refuerzo de la faena Cholguán", authorizedBy: "Gerencia", vehicleIds: [IDS.machineBio] },
    today,
  ))
  expect(transfer.ok).toBe(true)
})

beforeEach(async () => {
  await testDb.delete(schema.approvalDecisions)
  await resetState()
})

describe("nota de Biodiversa con el equipo hoy en Cholguán: quien sólo tiene Cholguán la compra", () => {
  it("«Comprar» a mano (persistRepuestoDraft con partsNoteItemId) guarda el borrador y la línea queda en compra", async () => {
    const note = await noteWithOrder()
    const session = await sessionIn([IDS.wsCho])
    // Lo mismo que ya acepta `loadPartsNotePrefill`: el formulario `?np=` abre y propone la faena del equipo (Cholguán).
    expect((await loadPartsNotePrefill(viewerFromSession(session), note.noteId))?.worksiteId).toBe(IDS.wsCho)

    const requestId = await persistRepuestoDraft(session, draft(IDS.wsCho, [{ partsNoteItemId: note.lineIds[0], workOrderId: OT, vehicleId: IDS.machineBio }]))
    const [item] = await testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(item).toMatchObject({ partsNoteItemId: note.lineIds[0], workOrderId: OT, vehicleId: IDS.machineBio })
    expect((await itemRow(note.lineIds[0]!)).resolution).toBe("en_compra")
  })

  it("«Enviar a compra» desde la nota crea la solicitud en Cholguán, aprobada", async () => {
    const note = await noteWithOrder()
    const sent = await sendPartsNoteLinesToPurchase(await sessionIn([IDS.wsCho]), { noteId: note.noteId, origin: "aceptar" })
    expect(sent.approved).toBe(true)
    expect((await requestsOf())[0]).toMatchObject({ id: sent.requestId, worksiteId: IDS.wsCho, status: "approved" })
    expect((await itemRow(note.lineIds[0]!)).resolution).toBe("en_compra")
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
  })
})

describe("una nota sin relación con la faena de quien la compra sigue informándose como inexistente", () => {
  it("«Comprar» a mano: ni la faena de la nota ni la actual del equipo están en su alcance", async () => {
    const note = await noteWithOrder()
    const unrelated = await sessionIn([IDS.wsAra])
    expect(await message(() => persistRepuestoDraft(unrelated, draft(IDS.wsCho, [{ partsNoteItemId: note.lineIds[0], workOrderId: OT, vehicleId: IDS.machineBio }]))))
      .toBe("La línea de la nota de pedido ya no existe: quita ese ítem de la solicitud")
    expect(await requestsOf()).toEqual([])
    expect((await itemRow(note.lineIds[0]!)).resolution).toBe("pendiente")
  })

  it("«Comprar» a mano una nota sin OT de otra faena", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    expect(await message(async () => persistRepuestoDraft(await sessionIn([IDS.wsCho]), draft(IDS.wsCho, [{ partsNoteItemId: note.itemIds[0] }]))))
      .toBe("La línea de la nota de pedido ya no existe: quita ese ítem de la solicitud")
    expect(await requestsOf()).toEqual([])
  })

  it("«Enviar a compra» desde la nota: la guarda de gestión lo rechaza antes de crear nada", async () => {
    const note = await noteWithOrder()
    expect(await message(async () => sendPartsNoteLinesToPurchase(await sessionIn([IDS.wsAra]), { noteId: note.noteId })))
      .toBe("Esta nota de pedido es de una faena que no es de tu alcance.")
    expect(await requestsOf()).toEqual([])
    expect(await expectInvariant(note.noteId)).toBe("enviada")
  })
})
