import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { eq, sql } from "drizzle-orm"
import { readFileSync } from "node:fs"
import {
  IDS,
  MIGRATION_0405,
  NOW,
  OT_ID,
  eventsOf,
  expectDbError,
  expectInvariant,
  ingress,
  itemRow,
  link,
  makeProduct,
  manualNote,
  noteRow,
  orderFor,
  phoneOtNote,
  refused,
  registerReceipt,
  requestFor,
  resetState,
  setupDatabase,
  testDb,
  viewerOf,
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

const transitions = await import("@/lib/services/mantencion/parts-notes/transitions")
const { allowedNoteActions } = transitions
const resolver = await import("@/lib/services/mantencion/parts-notes/resolve")

/**
 * Transiciones de cabecera de la nota de pedido (ADR 0001, 2026-11-27) contra Postgres de verdad: cada acción válida e
 * inválida por estado, el motivo, el permiso, el alcance de faena, la espera, la reapertura, el historial append-only y el
 * backfill de la migración 0405. Tras cada operación se verifica la invariante: el estado de la nota es el de su último
 * evento (el de mayor `seq`). Las notas sin OT están en `np-sin-ot-pglite.test.ts`.
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

describe("matriz de acciones de cabecera (función pura)", () => {
  const manage = { manage: true, reopen: false }
  const both = { manage: true, reopen: true }
  const open = { rejectedLines: 0, workOrderOpen: true }

  it("cada estado ofrece sólo sus acciones válidas, con el permiso y los hechos que piden", () => {
    expect(allowedNoteActions("enviada", manage, open)).toEqual(["aceptar", "en_espera", "rechazar", "anular"])
    expect(allowedNoteActions("aceptada", manage, open)).toEqual(["en_espera", "rechazar", "anular"])
    expect(allowedNoteActions("en_espera", manage, open)).toEqual(["aceptar", "rechazar", "anular"])
    expect(allowedNoteActions("en_gestion", manage, open)).toEqual(["rechazar", "anular"])
    expect(allowedNoteActions("en_compra", manage, open)).toEqual(["anular"])
    expect(allowedNoteActions("recibida_parcial", manage, open)).toEqual(["anular"])
    for (const status of ["cerrada", "rechazada", "anulada"] as const) {
      expect(allowedNoteActions(status, both, { rejectedLines: 0, workOrderOpen: true }).includes("anular")).toBe(false)
    }
  })

  it("reabrir: sólo una rechazada o una cerrada con líneas rechazadas, de una OT abierta, y con el permiso de reabrir", () => {
    expect(allowedNoteActions("rechazada", both, { rejectedLines: 2, workOrderOpen: true })).toEqual(["reabrir"])
    expect(allowedNoteActions("cerrada", both, { rejectedLines: 1, workOrderOpen: true })).toEqual(["reabrir"])
    expect(allowedNoteActions("cerrada", both, { rejectedLines: 0, workOrderOpen: true })).toEqual([])
    expect(allowedNoteActions("rechazada", both, { rejectedLines: 2, workOrderOpen: false })).toEqual([])
    expect(allowedNoteActions("rechazada", manage, { rejectedLines: 2, workOrderOpen: true })).toEqual([])
  })

  it("sin permiso de gestión no hay acciones de cabecera; anulada no admite ninguna", () => {
    expect(allowedNoteActions("enviada", { manage: false, reopen: false }, open)).toEqual([])
    expect(allowedNoteActions("anulada", both, { rejectedLines: 3, workOrderOpen: true })).toEqual([])
  })
})

describe("transiciones de cabecera sobre una nota con OT", () => {
  it("aceptar, poner en espera, aceptar de nuevo, rechazar, reabrir y anular: cada paso deja su estado y su evento", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await phoneOtNote()
    expect(await expectInvariant(note.noteId)).toBe("enviada")

    expect(await transitions.acceptPartsNote(jefe, { noteId: note.noteId })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("aceptada")

    expect(await transitions.holdPartsNote(jefe, { noteId: note.noteId, reason: "Falta cotizar el aceite" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("en_espera")
    expect((await noteRow(note.noteId)).holdReason).toBe("Falta cotizar el aceite")

    // Quien vuelve a aceptar la saca de la espera: sin líneas resueltas, vuelve a «aceptada» y el motivo se borra.
    expect(await transitions.acceptPartsNote(jefe, { noteId: note.noteId })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("aceptada")
    expect((await noteRow(note.noteId)).holdReason).toBeNull()

    expect(await transitions.rejectPartsNote(jefe, { noteId: note.noteId, reason: "No corresponde al equipo" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("rechazada")
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("rechazada")
    expect((await itemRow(note.itemIds[1]!)).resolution).toBe("rechazada")

    expect(await transitions.reopenPartsNote(jefe, { noteId: note.noteId, reason: "Sí corresponde, se volvió a pedir" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("enviada")
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")

    expect(await transitions.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("anulada")
    expect(await noteRow(note.noteId)).toMatchObject({ voidReason: "Se pidió por error", voidedByUserId: IDS.jefe })

    // Cada paso queda en el historial, en orden, con quien lo hizo y su motivo.
    const kinds = (await eventsOf(note.noteId)).map((event) => [event.kind, event.toStatus])
    expect(kinds).toEqual([
      ["creada", "enviada"], ["transicion", "aceptada"], ["transicion", "en_espera"], ["transicion", "aceptada"],
      ["transicion", "rechazada"], ["transicion", "enviada"], ["transicion", "anulada"],
    ])
  })

  it("una acción que no vale para el estado se rechaza con su motivo y no escribe nada", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await phoneOtNote()
    await transitions.acceptPartsNote(jefe, { noteId: note.noteId })
    expect((await refused(() => transitions.acceptPartsNote(jefe, { noteId: note.noteId }), note.noteId)).message)
      .toBe(`La nota ${note.code} está aceptada: no se puede aceptar.`)
    expect((await refused(() => transitions.reopenPartsNote(jefe, { noteId: note.noteId, reason: "Motivo de prueba" }), note.noteId)).message)
      .toBe(`La nota ${note.code} está aceptada: no se puede reabrir.`)

    await transitions.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })
    expect((await refused(() => transitions.holdPartsNote(jefe, { noteId: note.noteId, reason: "Espera tardía" }), note.noteId)).message)
      .toBe(`La nota ${note.code} ya está anulada.`)
  })

  it("el motivo es obligatorio (al menos 5 letras) para poner en espera, rechazar, anular y reabrir", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await phoneOtNote()
    expect(await refused(() => transitions.holdPartsNote(jefe, { noteId: note.noteId, reason: "  abc " }), note.noteId))
      .toEqual({ message: "Escribe el motivo de la espera (al menos 5 letras).", field: "reason" })
    expect(await refused(() => transitions.rejectPartsNote(jefe, { noteId: note.noteId }), note.noteId))
      .toEqual({ message: "Escribe el motivo del rechazo (al menos 5 letras).", field: "reason" })
    expect(await refused(() => transitions.voidPartsNote(jefe, { noteId: note.noteId, reason: "    " }), note.noteId))
      .toEqual({ message: "Escribe el motivo de la anulación (al menos 5 letras).", field: "reason" })
    // Aceptar no pide motivo.
    expect(await transitions.acceptPartsNote(jefe, { noteId: note.noteId })).toMatchObject({ ok: true })
  })

  it("sin permiso de gestión no se actúa; reabrir exige su propio permiso; otra faena queda fuera", async () => {
    const note = await phoneOtNote()
    const mechanic = await viewerOf(IDS.mecBio)
    expect((await refused(() => transitions.acceptPartsNote(mechanic, { noteId: note.noteId }), note.noteId)).message)
      .toBe("No tienes permiso para resolver notas de pedido.")

    const supervisor = await viewerOf(IDS.supBio)
    await transitions.rejectPartsNote(await viewerOf(IDS.jefe), { noteId: note.noteId, reason: "No corresponde al equipo" })
    expect((await refused(() => transitions.reopenPartsNote(supervisor, { noteId: note.noteId, reason: "Motivo de prueba" }), note.noteId)).message)
      .toBe("No tienes permiso para reabrir notas de pedido.")

    // Una faena que no es del alcance de quien actúa: Cholguán para el supervisor de Biodiversa.
    const cho = await manualNote([{ description: "Bomba hidráulica especial", quantity: 1 }], IDS.jefe)
    await testDb.update(schema.mantPartsNotes).set({ worksiteId: IDS.wsCho }).where(eq(schema.mantPartsNotes.id, cho.noteId))
    const choReason = await refused(() => transitions.acceptPartsNote(supervisor, { noteId: cho.noteId }), cho.noteId)
    expect(choReason.message).toBe("Esta nota de pedido es de una faena que no es de tu alcance.")
  })

  it("en espera: las líneas no se resuelven; sí se puede rechazar la nota entera", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 5)
    const note = await phoneOtNote()
    await transitions.holdPartsNote(jefe, { noteId: note.noteId, reason: "Esperando presupuesto" })
    expect(await refused(() => resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Ya no hace falta" }), note.noteId))
      .toMatchObject({ message: "La nota está en espera: acéptala primero." })
    expect(await refused(() => resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 1 }), note.noteId))
      .toMatchObject({ message: "La nota está en espera: acéptala primero." })

    expect(await transitions.rejectPartsNote(jefe, { noteId: note.noteId, reason: "El equipo ya no lo necesita" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("rechazada")
  })

  it("reabrir una nota cerrada sin líneas rechazadas no pasa: hay que pedir con una nota nueva", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await manualNote([{ description: "Correa de transmisión", quantity: 1 }])
    const [item] = note.itemIds as [string]
    const request = await requestFor(item, "purchased")
    await link(item, request.itemId)
    const product = await makeProduct("Correa de transmisión")
    const order = await orderFor(request.itemId, product, 1)
    await registerReceipt({ purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio, items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 1 }] })
    expect(await expectInvariant(note.noteId)).toBe("cerrada")
    expect((await refused(() => transitions.reopenPartsNote(jefe, { noteId: note.noteId, reason: "Se quiere pedir de nuevo" }), note.noteId)).message)
      .toBe("Todo lo pedido ya llegó a la faena: pide con una nota nueva.")
  })

  it("reabrir una rechazada de una OT que ya terminó no pasa: la línea no volvería a nadie", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await phoneOtNote()
    await transitions.rejectPartsNote(jefe, { noteId: note.noteId, reason: "No corresponde al equipo" })
    await testDb.update(schema.mantWorkOrders).set({ status: "anulada", voidedAt: NOW, voidedByUserId: IDS.jefe, voidReason: "Equipo dado de baja" }).where(eq(schema.mantWorkOrders.id, OT_ID))
    const refusal = await refused(() => transitions.reopenPartsNote(jefe, { noteId: note.noteId, reason: "Motivo de prueba" }), note.noteId)
    expect(refusal.message).toBe("La orden OT-TR-1 ya terminó: pide con una nota nueva.")
    await testDb.update(schema.mantWorkOrders).set({ status: "en_ejecucion", voidedAt: null, voidedByUserId: null, voidReason: null }).where(eq(schema.mantWorkOrders.id, OT_ID))
  })
})

describe("historial de la nota", () => {
  it("es append-only: un evento no se edita ni se borra", async () => {
    const note = await manualNote()
    const [event] = await eventsOf(note.noteId)
    await expectDbError(() => testDb.update(schema.mantPartsNoteEvents).set({ reason: "cambiado" }).where(eq(schema.mantPartsNoteEvents.id, event!.id)), /append-only/)
    await expectDbError(() => testDb.delete(schema.mantPartsNoteEvents).where(eq(schema.mantPartsNoteEvents.id, event!.id)), /append-only/)
    expect(await eventsOf(note.noteId)).toHaveLength(1)
  })

  it("el backfill de la migración 0405 es idempotente: una nota sin historial recibe UN evento «migrada» con su estado y su fecha", async () => {
    await testDb.insert(schema.mantPartsNotes).values({
      id: "np-tr-old", code: "NP-TR-OLD", workOrderId: OT_ID, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio,
      requestedByUserId: IDS.mecBio, status: "cerrada", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z",
    })
    // Las sentencias del propio archivo de la migración (el trozo que inserta el historial), tal cual salen en el repo.
    const migration = readFileSync(MIGRATION_0405, "utf8")
    const backfill = migration.slice(migration.indexOf('INSERT INTO "mant_parts_note_events"'))
    const statement = backfill.split(";")[0]! + ";"
    await testDb.execute(sql.raw(statement))
    await testDb.execute(sql.raw(statement))
    const events = await eventsOf("np-tr-old")
    expect(events.map((event) => [event.kind, event.fromStatus, event.toStatus, new Date(event.createdAt).toISOString()])).toEqual([
      ["migrada", null, "cerrada", "2026-10-01T10:00:00.000Z"],
    ])
  })
})
