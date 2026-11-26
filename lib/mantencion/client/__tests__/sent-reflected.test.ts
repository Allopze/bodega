import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import type { CatalogOwnRecord } from "../../contracts"
import { buildRows, dueRows, workshopEntries } from "../fleet-view"
import { rejectedNotes } from "../home-model"
import { buildOtViews } from "../ot-model"
import { discardRejectedNote, enqueueSimple, listQueue, newReplyItem, newWorkshopItem, pruneSent } from "../queue"
import type { QueueItem, QueueRecordItem } from "../types"
import { UUID, catalog, equipment, freshDb, otOpItem, recordItem, storedCatalog, workOrder } from "./fixtures"

// El catálogo de las fixtures se generó el 2026-10-28 12:00Z.
const BEFORE = "2026-10-28T11:00:00.000Z"
const AFTER = "2026-10-28T13:00:00.000Z"

const sent = (item: QueueRecordItem, sentAt: string): QueueRecordItem => ({ ...item, status: "sent", sentAt, folio: "MP-BIO-0009" })
const ownRecord = (id: string, status: "vigente" | "anulado"): CatalogOwnRecord => ({
  id, folio: "MP-BIO-0009", kind: "P", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", workDate: "2026-10-28",
  receivedAt: "2026-10-28T11:00:00.000Z", status, review: "pendiente", intervalValue: 40_000, unit: "km",
})
// El equipo del servidor lee 39.000 km, vencida (próxima lectura 40.000).
const base = () => equipment({ readings: [{ value: 39_000, date: "2026-10-01", source: "x" }], state: "vencida", remaining: -1000, nextReading: 40_000 })

describe("un registro enviado deja de contar cuando el catálogo ya lo refleja o lo anuló (APPN-1)", () => {
  const record = recordItem(UUID(1), "u-1", [UUID(11), UUID(12)])

  it("enviado ANTES del catálogo: no suma lectura ni preventiva", () => {
    const [row] = buildRows(storedCatalog("u-1", [base()]), [sent(record, BEFORE)])
    expect(row?.status.currentReading?.value).toBe(39_000)
    expect(row?.recentPreventives).toEqual([])
    expect(row?.readings.map((reading) => reading.value)).toEqual([39_000])
    expect(row?.status.state).toBe("vencida")
  })

  it("enviado DESPUÉS del catálogo: sí suma (el catálogo todavía no lo trae)", () => {
    const [row] = buildRows(storedCatalog("u-1", [base()]), [sent(record, AFTER)])
    expect(row?.status.currentReading?.value).toBe(40_312)
    expect(row?.recentPreventives.map((entry) => entry.id)).toEqual([UUID(1)])
    expect(row?.status.state).toBe("al_dia")
  })

  it("enviado y anulado por jefatura (el catálogo lo marca anulado): no suma, tampoco «Le toca» queda mal", () => {
    const stored = storedCatalog("u-1", [base()])
    stored.catalog.myRecords = [ownRecord(UUID(1), "anulado")]
    const rows = buildRows(stored, [sent(record, AFTER)])
    expect(rows[0]?.status.currentReading?.value).toBe(39_000)
    expect(rows[0]?.recentPreventives).toEqual([])
    expect(dueRows(rows).map((row) => row.eq.code)).toEqual(["KA-140"])
  })

  it("manda la hora de recepción del SERVIDOR, no el reloj del teléfono", () => {
    // Teléfono atrasado: su `sentAt` dice antes del catálogo, pero el servidor lo recibió después.
    const behind = { ...sent(record, BEFORE), receivedAt: AFTER }
    expect(buildRows(storedCatalog("u-1", [base()]), [behind])[0]?.status.currentReading?.value).toBe(40_312)
    // Teléfono adelantado: su `sentAt` dice después, pero el servidor lo recibió antes del catálogo.
    const ahead = { ...sent(record, AFTER), receivedAt: BEFORE }
    expect(buildRows(storedCatalog("u-1", [base()]), [ahead])[0]?.status.currentReading?.value).toBe(39_000)
  })

  it("un registro pendiente (sin enviar) sigue contando", () => {
    const [row] = buildRows(storedCatalog("u-1", [base()]), [record])
    expect(row?.status.currentReading?.value).toBe(40_312)
  })

  it("un registro enviado y reflejado no cuenta como vinculado de la OT", () => {
    const cat = catalog("u-1", [equipment()])
    cat.workOrders = [workOrder({ status: "en_ejecucion" })]
    const linked = { ...record, payload: { ...record.payload, workOrderId: "ot-1" } as QueueRecordItem["payload"] }
    const user = { id: "u-1", name: "Javier Roa" }
    expect(buildOtViews(cat, [sent(linked, AFTER)], user).mine[0]?.linked.map((l) => l.id)).toEqual([UUID(1)])
    expect(buildOtViews(cat, [sent(linked, BEFORE)], user).mine[0]?.linked).toEqual([])
    const voided = { ...cat, myRecords: [ownRecord(UUID(1), "anulado")] }
    expect(buildOtViews(voided, [sent(linked, AFTER)], user).mine[0]?.linked).toEqual([])
  })
})

describe("un equipo cuya salida ya registró la web no reaparece en taller (APPN-2)", () => {
  const corrective = (): QueueRecordItem => {
    const item = recordItem(UUID(70), "u-1", [UUID(71), UUID(72)])
    return { ...item, summary: { ...item.summary, kind: "C", intervalValue: null, inWorkshop: true, workshopEntryDate: "2026-10-26" } }
  }
  const entries = (queue: QueueItem[]) => {
    const stored = storedCatalog("u-1", [equipment()])
    return workshopEntries(buildRows(stored, queue), queue, stored.catalog, "2026-10-28")
  }

  it("correctiva enviada antes del catálogo (el servidor ya no lo tiene en taller): no aparece", () => {
    expect(entries([sent(corrective(), BEFORE)])).toEqual([])
  })

  it("correctiva enviada después del catálogo: aparece hasta que el catálogo la refleje", () => {
    expect(entries([sent(corrective(), AFTER)]).map((entry) => entry.recordId)).toEqual([UUID(70)])
  })

  it("correctiva anulada en la web: no aparece", () => {
    const stored = storedCatalog("u-1", [equipment()])
    stored.catalog.myRecords = [ownRecord(UUID(70), "anulado")]
    const queue = [sent(corrective(), AFTER)]
    expect(workshopEntries(buildRows(stored, queue), queue, stored.catalog, "2026-10-28")).toEqual([])
  })
})

describe("rechazos que no son registros (APP-5, APPN-2)", () => {
  beforeEach(freshDb)
  const rejected = <T extends QueueItem>(item: T): T => ({ ...item, status: "rejected" as const, lastError: "El equipo ya salió de taller." })
  const workshop = () => rejected(newWorkshopItem({
    authorUserId: "u-1",
    payload: { id: UUID(61), recordId: UUID(50), kind: "salio", exitDate: "2026-10-28", createdAt: "2026-10-28T15:00:00.000Z", deviceId: UUID(900) },
    summary: { vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84" },
  }))
  const reply = () => rejected(newReplyItem({
    authorUserId: "u-1", payload: { observationId: "o1", response: "Corregido" }, summary: { folio: "MP-BIO-0001", equipmentCode: "KA-140" },
  }, UUID(62)))
  const ot = () => rejected(otOpItem(3, { action: "finish", exitAt: "2026-10-29T12:00:00.000Z", note: null }))

  it("aparecen taller, respuesta y OT del autor, con su motivo; los de otro autor no", () => {
    const foreign = { ...workshop(), id: UUID(99), authorUserId: "u-2" }
    const notes = rejectedNotes([workshop(), reply(), ot(), foreign, { ...recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), status: "rejected" as const }], "u-1")
    expect(notes.map((note) => note.type)).toEqual(["workshop", "reply", "ot"])
    expect(notes[0]).toMatchObject({ title: "KA-140 · Salida de taller", message: "El equipo ya salió de taller." })
    expect(notes[1]?.title).toBe("KA-140 · Respuesta a la observación de MP-BIO-0001")
    expect(notes[2]?.title).toBe("KA-140 · OT-BIO-0001 · Registrar salida de taller")
  })

  it("«Entendido» los quita de la cola, y no se podan solos", async () => {
    await enqueueSimple(workshop())
    await enqueueSimple(reply())
    await pruneSent(Date.now() + 365 * 24 * 3600_000)
    expect(await listQueue()).toHaveLength(2)
    await discardRejectedNote(UUID(61))
    expect((await listQueue()).map((item) => item.id)).toEqual([UUID(62)])
  })

  it("no descarta lo que sigue pendiente ni un registro", async () => {
    const pending = newWorkshopItem({
      authorUserId: "u-1",
      payload: { id: UUID(63), recordId: UUID(50), kind: "sigue", note: "Esperando repuesto", createdAt: "2026-10-28T15:00:00.000Z", deviceId: UUID(900) },
      summary: { vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84" },
    })
    await enqueueSimple(pending)
    await discardRejectedNote(UUID(63))
    expect(await listQueue()).toHaveLength(1)
  })
})
