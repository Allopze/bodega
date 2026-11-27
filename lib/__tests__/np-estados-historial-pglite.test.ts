import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"
import {
  IDS,
  NOW,
  OT_ID,
  contextOf,
  createPartsNote,
  createPartsNoteFromDevice,
  eventsOf,
  expectInvariant,
  itemRow,
  link,
  makeProduct,
  manualNote,
  noteRow,
  orderFor,
  phoneNote,
  phoneOtNote,
  requestFor,
  resetState,
  setupDatabase,
  testDb,
  unlinkNoteItemsFromRequestTx,
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

const { acceptPartsNote, holdPartsNote, rejectPartsNote, reopenPartsNote } = await import("@/lib/services/mantencion/parts-notes/transitions")
const { rejectOpenLinesOfWorkOrderTx } = await import("@/lib/services/mantencion/parts-notes/line-rejection")
const { noteWasAccepted, recalcNoteStatusTx } = await import("@/lib/services/mantencion/parts-notes/status")
const { getPartsNote, listPartsNotes } = await import("@/lib/services/mantencion/parts-notes/query")
const { exportPartsNotes } = await import("@/lib/services/mantencion/parts-notes/export")
const { applyPlannedNotes } = await import("@/lib/services/mantencion/parts-notes/import/apply")
const { LEGACY_RECALC_REASON, recalcLegacyNoteStatuses } = await import("@/lib/services/mantencion/parts-notes/recalc-legacy")
const script = await import("@/scripts/np-recalcular-estados")

/**
 * Estados de la nota de pedido que salen del historial y de las líneas (ADR 0001, 2026-11-27), contra Postgres de verdad:
 *
 *  - D23 · una nota «en espera» cuya OT termina sale de la espera (evento automático) en vez de quedar en «En gestión»;
 *  - D26 · «aceptada» se deriva del historial: sobrevive a una compra que muere y se borra con una reapertura;
 *  - D27 · una importada «Cerrada» muestra sus líneas como llegadas, sin cambiar el estado derivado;
 *  - D28 · el recálculo único de las notas anteriores a 0405 (simulación sin escritura, idempotente, sólo notas de la plataforma);
 *  - D22 · el alta en una faena cerrada se rechaza en el servidor (web y teléfono).
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

const toStatuses = async (noteId: string) => (await eventsOf(noteId)).map((event) => event.toStatus)

describe("nota en espera cuya OT termina (D23)", () => {
  it.each([
    ["cerrada", { kind: "cerrada" as const }, /orden de trabajo se cerró/],
    ["anulada", { kind: "anulada" as const, reason: "El equipo se dio de baja" }, /orden de trabajo se anuló: El equipo se dio de baja/],
  ])("con la OT %s, la nota sale de la espera con un evento automático y no queda en «En gestión»", async (_name, end, reasonPattern) => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await phoneOtNote()
    expect((await holdPartsNote(jefe, { noteId: note.noteId, reason: "Esperando una cotización" })).ok).toBe(true)
    expect(await noteRow(note.noteId)).toMatchObject({ status: "en_espera", holdReason: "Esperando una cotización" })

    const swept = await testDb.transaction((tx) => rejectOpenLinesOfWorkOrderTx(tx as unknown as Tx, { workOrderId: OT_ID, actor: { userId: IDS.jefe }, end }))
    expect(swept).toEqual({ notes: 1, lines: 2 })

    expect(await noteRow(note.noteId)).toMatchObject({ status: "rechazada", holdReason: null })
    expect(await expectInvariant(note.noteId)).toBe("rechazada")
    const events = await eventsOf(note.noteId)
    const last = events.at(-1)!
    expect(last).toMatchObject({ kind: "transicion", fromStatus: "en_espera", toStatus: "rechazada", actorUserId: null })
    expect(last.reason).toMatch(reasonPattern)

    const inboxGestion = await listPartsNotes(jefe, { tab: "en_gestion" })
    expect(inboxGestion.rows.some((row) => row.id === note.noteId)).toBe(false)
    const inboxRejected = await listPartsNotes(jefe, { tab: "cerradas" })
    expect(inboxRejected.rows.some((row) => row.id === note.noteId)).toBe(true)

    // Repetirlo no cambia nada: la nota ya terminó.
    const again = await testDb.transaction((tx) => rejectOpenLinesOfWorkOrderTx(tx as unknown as Tx, { workOrderId: OT_ID, actor: { userId: IDS.jefe }, end }))
    expect(again).toEqual({ notes: 0, lines: 0 })
    expect(await eventsOf(note.noteId)).toHaveLength(events.length)
  })
})

describe("«aceptada» se deriva del historial (D26)", () => {
  it("aceptada → en compra → la compra muere → vuelve a «aceptada», no a «enviada»", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await manualNote([{ description: "Rodamiento 6205", quantity: 1 }])
    expect((await acceptPartsNote(jefe, { noteId: note.noteId })).ok).toBe(true)
    const request = await requestFor(note.itemIds[0]!)
    await link(note.itemIds[0]!, request.itemId)
    expect(await expectInvariant(note.noteId)).toBe("en_compra")

    await testDb.update(schema.purchaseRequests).set({ status: "cancelled" }).where(eq(schema.purchaseRequests.id, request.requestId))
    await testDb.transaction((tx) => unlinkNoteItemsFromRequestTx(tx as unknown as Tx, { noteItemIds: note.itemIds, actorUserId: IDS.jefe }))

    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect(await expectInvariant(note.noteId)).toBe("aceptada")
    expect(await toStatuses(note.noteId)).toEqual(["enviada", "aceptada", "en_compra", "aceptada"])
  })

  it("una nota que nadie aceptó vuelve a «enviada» cuando su compra muere", async () => {
    const note = await manualNote([{ description: "Rodamiento 6205", quantity: 1 }])
    const request = await requestFor(note.itemIds[0]!)
    await link(note.itemIds[0]!, request.itemId)
    await testDb.update(schema.purchaseRequests).set({ status: "cancelled" }).where(eq(schema.purchaseRequests.id, request.requestId))
    await testDb.transaction((tx) => unlinkNoteItemsFromRequestTx(tx as unknown as Tx, { noteItemIds: note.itemIds, actorUserId: IDS.jefe }))
    expect(await expectInvariant(note.noteId)).toBe("enviada")
    expect(await toStatuses(note.noteId)).toEqual(["enviada", "en_compra", "enviada"])
  })

  it("una reapertura borra la aceptación: rechazada → reabrir queda «enviada» (y se puede aceptar de nuevo)", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await manualNote([{ description: "Rodamiento 6205", quantity: 1 }])
    expect((await acceptPartsNote(jefe, { noteId: note.noteId })).ok).toBe(true)
    expect((await rejectPartsNote(jefe, { noteId: note.noteId, reason: "Ya no se necesita" })).ok).toBe(true)
    expect(await expectInvariant(note.noteId)).toBe("rechazada")
    expect((await reopenPartsNote(jefe, { noteId: note.noteId, reason: "Sí se necesita" })).ok).toBe(true)
    expect(await expectInvariant(note.noteId)).toBe("enviada")
    expect(await toStatuses(note.noteId)).toEqual(["enviada", "aceptada", "rechazada", "enviada"])
    // Un recálculo posterior no la devuelve a «aceptada».
    await testDb.transaction((tx) => recalcNoteStatusTx(tx as unknown as Tx, note.noteId, { onlyIfChanged: true }))
    expect(await expectInvariant(note.noteId)).toBe("enviada")
    expect((await acceptPartsNote(jefe, { noteId: note.noteId })).ok).toBe(true)
  })

  it("noteWasAccepted: un evento hacia «aceptada» cuenta hasta que se sale de un estado final", () => {
    const ev = (fromStatus: string | null, toStatus: string) => ({ fromStatus, toStatus })
    expect(noteWasAccepted([])).toBe(false)
    expect(noteWasAccepted([ev(null, "enviada")])).toBe(false)
    expect(noteWasAccepted([ev(null, "enviada"), ev("enviada", "aceptada"), ev("aceptada", "en_compra")])).toBe(true)
    expect(noteWasAccepted([ev(null, "aceptada")])).toBe(true)
    expect(noteWasAccepted([ev(null, "enviada"), ev("enviada", "aceptada"), ev("aceptada", "rechazada")])).toBe(true)
    expect(noteWasAccepted([ev(null, "enviada"), ev("enviada", "aceptada"), ev("aceptada", "rechazada"), ev("rechazada", "enviada")])).toBe(false)
    expect(noteWasAccepted([ev(null, "enviada"), ev("enviada", "aceptada"), ev("aceptada", "cerrada"), ev("cerrada", "en_gestion"), ev("en_gestion", "aceptada")])).toBe(true)
  })
})

describe("importadas «Cerrada»: sus líneas se muestran como llegadas (D27)", () => {
  async function importNote(externalRef: string, status: "cerrada" | "enviada") {
    const result = await applyPlannedNotes(testDb, [{
      externalRef, erpId: externalRef.replace("CHOME-", ""), createdAt: "2026-05-02T14:15:00.000Z", folioYear: 2026, worksiteId: IDS.wsBio, worksiteName: "Biodiversa",
      requestedByUserId: null, requestedByName: "Taller Biodiversa", urgent: false, notes: null, status, holdReason: null, warnings: [],
      lines: [{
        sortOrder: 0, description: "Filtro de aceite", quantity: 3, unitOfMeasure: "unidad", partNumber: null, productId: null, chargeVehicleId: null,
        chargeCostCenterId: null, chargeText: null, suggestedSupplierId: null, supplierHint: null,
        resolution: status === "cerrada" ? "en_compra" : "pendiente", resolutionReason: status === "cerrada" ? "Cerrada en CHOME ERP: lo pedido llegó a la faena" : null,
      }],
    }], { userId: IDS.jefe, email: "jefe@chome.test" })
    expect(result.failed).toEqual([])
    return result.applied[0]!
  }

  it("el detalle y el Excel dicen «en bodega» y «Llegó» = lo pedido, y el estado sigue siendo «cerrada»", async () => {
    const closed = await importNote("CHOME-8801", "cerrada")
    const open = await importNote("CHOME-8802", "enviada")
    const jefe = await viewerOf(IDS.jefe)

    const detail = await getPartsNote(jefe, closed.noteId)
    expect(detail).toMatchObject({ status: "cerrada" })
    expect(detail!.lines[0]).toMatchObject({ resolution: "en_compra", stage: "en_bodega", arrived: 3, purchases: [] })
    // La derivación no cambia: recalcular no mueve la nota ni escribe un evento.
    const before = (await eventsOf(closed.noteId)).length
    await testDb.transaction((tx) => recalcNoteStatusTx(tx as unknown as Tx, closed.noteId, { onlyIfChanged: true }))
    expect((await noteRow(closed.noteId)).status).toBe("cerrada")
    expect(await eventsOf(closed.noteId)).toHaveLength(before)

    // Una importada que no está «Cerrada» no cambia.
    expect((await getPartsNote(jefe, open.noteId))!.lines[0]).toMatchObject({ stage: "pedido", arrived: 0 })

    const { viewer, userName } = await contextOf(IDS.jefe)
    const session = { user: { id: viewer.userId, email: viewer.email, name: userName, permissions: viewer.permissions, worksiteIds: viewer.worksiteIds, isGlobal: viewer.isGlobal }, expires: "2099-01-01" } as unknown as Session
    const exported = await exportPartsNotes({ session, filters: {} })
    if (!exported.ok) throw new Error(exported.message)
    const sheet = (await new ExcelJS.Workbook().xlsx.load(exported.buffer)).getWorksheet("Notas de pedido")!
    const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String)
    const arrivedColumn = header.indexOf("Llegó a la faena") + 1
    const refColumn = header.indexOf("Referencia externa") + 1
    const arrivedByRef = new Map<string, unknown>()
    sheet.eachRow((row, index) => { if (index > 1) arrivedByRef.set(String(row.getCell(refColumn).value), row.getCell(arrivedColumn).value) })
    expect(arrivedByRef.get("CHOME-8801")).toBe(3)
    expect(arrivedByRef.get("CHOME-8802")).toBe(0)
  })

  it("una nota de la plataforma «cerrada» con una línea «en compra» sin compra no se da por llegada (la regla es de las importadas)", async () => {
    const note = await manualNote([{ description: "Filtro de aceite", quantity: 3 }])
    await testDb.update(schema.mantPartsNoteItems).set({ resolution: "en_compra", resolvedByUserId: IDS.jefe, resolvedAt: NOW }).where(eq(schema.mantPartsNoteItems.id, note.itemIds[0]!))
    await testDb.update(schema.mantPartsNotes).set({ status: "cerrada" }).where(eq(schema.mantPartsNotes.id, note.noteId))
    const detail = await getPartsNote(await viewerOf(IDS.jefe), note.noteId)
    expect(detail!.lines[0]).toMatchObject({ stage: "pedido", arrived: 0 })
  })
})

describe("recálculo único de las notas anteriores a 0405 (D28)", () => {
  /** Una nota en compra a la que ya llegó parte, con el estado que tenía antes de que existiera «recibida parcial». */
  async function staleNote() {
    const product = await makeProduct(`Filtro ${crypto.randomUUID().slice(0, 6)}`)
    const note = await manualNote([{ description: "Filtro de aceite", quantity: 2, productId: product }])
    const request = await requestFor(note.itemIds[0]!, "purchased")
    await link(note.itemIds[0]!, request.itemId)
    const order = await orderFor(request.itemId, product, 2)
    await testDb.update(schema.purchaseOrderItems).set({ quantityReceived: 1 }).where(eq(schema.purchaseOrderItems.id, order.ocItemId))
    expect((await noteRow(note.noteId)).status).toBe("en_compra")
    return note
  }

  it("la simulación cuenta lo que cambiaría sin escribir; --apply lo escribe con evento automático; repetirlo no cambia nada", async () => {
    const stale = await staleNote()
    const fresh = await manualNote([{ description: "Rodamiento", quantity: 1 }])
    const voided = await staleNote()
    await testDb.update(schema.mantPartsNotes).set({ status: "anulada", voidedAt: NOW, voidedByUserId: IDS.jefe, voidReason: "Se pidió por error" }).where(eq(schema.mantPartsNotes.id, voided.noteId))
    // Una importada con el mismo estado desfasado: queda fuera (trae su estado de origen).
    const imported = await staleNote()
    await testDb.update(schema.mantPartsNotes).set({ requestedByUserId: null, requestedByName: "Taller", externalRef: "CHOME-7001" }).where(eq(schema.mantPartsNotes.id, imported.noteId))
    const eventsBefore = (await eventsOf(stale.noteId)).length

    const dry = await recalcLegacyNoteStatuses(testDb, { apply: false })
    expect(dry).toMatchObject({ applied: false, total: 2 })
    expect(dry.changed).toEqual([{ noteId: stale.noteId, code: stale.code, from: "en_compra", to: "recibida_parcial" }])
    expect(script.formatSummary(dry)).toContain(`${stale.code}: en_compra -> recibida_parcial`)
    expect((await noteRow(stale.noteId)).status).toBe("en_compra")
    expect(await eventsOf(stale.noteId)).toHaveLength(eventsBefore)

    const applied = await recalcLegacyNoteStatuses(testDb, { apply: true })
    expect(applied).toMatchObject({ applied: true, total: 2, changed: [{ noteId: stale.noteId, from: "en_compra", to: "recibida_parcial" }] })
    expect(await expectInvariant(stale.noteId)).toBe("recibida_parcial")
    expect((await eventsOf(stale.noteId)).at(-1)).toMatchObject({ kind: "transicion", fromStatus: "en_compra", toStatus: "recibida_parcial", actorUserId: null, reason: LEGACY_RECALC_REASON })
    // Lo que no corresponde queda intacto: la que ya estaba bien, la anulada y la importada.
    expect((await noteRow(fresh.noteId)).status).toBe("enviada")
    expect((await noteRow(voided.noteId)).status).toBe("anulada")
    expect((await noteRow(imported.noteId)).status).toBe("en_compra")

    // Idempotente: la segunda corrida no encuentra nada que cambiar ni escribe eventos.
    const eventsAfter = (await eventsOf(stale.noteId)).length
    expect(await recalcLegacyNoteStatuses(testDb, { apply: true })).toMatchObject({ changed: [], total: 2 })
    expect(await eventsOf(stale.noteId)).toHaveLength(eventsAfter)
  })

  it("el script es una simulación salvo con --apply y rechaza opciones desconocidas", () => {
    expect(script.parseArgs(["node", "script"])).toEqual({ apply: false })
    expect(script.parseArgs(["node", "script", "--apply"])).toEqual({ apply: true })
    expect(() => script.parseArgs(["node", "script", "--aplicar"])).toThrow(/Opción desconocida/)
  })
})

describe("el alta en una faena cerrada se rechaza en el servidor (D22)", () => {
  async function withClosedWorksite<T>(run: () => Promise<T>): Promise<T> {
    await testDb.update(schema.worksites).set({ isActive: false }).where(eq(schema.worksites.id, IDS.wsBio))
    try {
      return await run()
    } finally {
      await testDb.update(schema.worksites).set({ isActive: true }).where(eq(schema.worksites.id, IDS.wsBio))
    }
  }

  it("la web (sin OT) y el teléfono (sin OT) contestan 422 «faena cerrada» y no crean nada; con la faena activa funciona", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const before = (await testDb.select({ id: schema.mantPartsNotes.id }).from(schema.mantPartsNotes)).length
    const lines = [{ description: "Rodamiento 6205", quantity: 2, unitOfMeasure: "unidad" }]
    await withClosedWorksite(async () => {
      expect(await createPartsNote(jefe, { clientOpId: `op-cerrada-${crypto.randomUUID()}`, worksiteId: IDS.wsBio, urgent: false, lines }))
        .toEqual({ ok: false, message: "Esa faena está cerrada: elige una faena activa.", field: "worksiteId" })
      const phone = await createPartsNoteFromDevice(phoneNote({ workOrderId: null, worksiteId: IDS.wsBio }), await contextOf(IDS.mecBio))
      expect(phone.status).toBe(422)
      expect(phone.body).toMatchObject({ ok: false, message: "Esa faena está cerrada: elige una faena activa." })
    })
    expect((await testDb.select({ id: schema.mantPartsNotes.id }).from(schema.mantPartsNotes)).length).toBe(before)

    expect((await createPartsNote(jefe, { clientOpId: `op-abierta-${crypto.randomUUID()}`, worksiteId: IDS.wsBio, urgent: false, lines })).ok).toBe(true)
  })
})
