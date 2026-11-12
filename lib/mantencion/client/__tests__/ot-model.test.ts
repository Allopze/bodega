import { describe, expect, it } from "vitest"
import type { MantCatalog } from "../../contracts"
import { buildRows } from "../fleet-view"
import { applyOp, buildOtViews, equipmentFromWorkOrder, findWorkOrder } from "../ot-model"
import { newRecordItem } from "../queue"
import type { QueueItem } from "../types"
import { ENTRY, UUID, catalog, correctivePayload, legacyTakeItem, otOpItem, storedCatalog, workOrder } from "./fixtures"

const USER = { id: "u-1", name: "Javier Roa" }
const WITH = (extra: Partial<MantCatalog>): MantCatalog => ({ ...catalog(), ...extra })

const linkedRecord = (n: number, signedAt = "2026-10-28T16:00:00.000Z"): QueueItem => newRecordItem({
  authorUserId: "u-1",
  payload: correctivePayload(UUID(n), UUID(n + 50), { workOrderId: "ot-1", inWorkshop: false, workshopEntryDate: null, workshopReason: null, signedAt }),
  photoIds: [UUID(n + 50)],
  summary: { kind: "C", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: null, workDate: "2026-10-28", reading: 40_400, inWorkshop: false, workshopEntryDate: null },
}, signedAt)

describe("ot-model: catálogo sin los campos de OT", () => {
  it("un catálogo guardado antes de las OT se toma como sin órdenes", () => {
    const views = buildOtViews(catalog(), [], USER)
    expect(views).toEqual({ mine: [] })
    expect(findWorkOrder(catalog(), "ot-1")).toBeNull()
  })
})

describe("ot-model: catálogo + cola", () => {
  it("un «tomar» viejo de la cola no cambia nada: el mecánico sólo ve las OT que tiene asignadas", () => {
    const base = WITH({ workOrders: [workOrder()] })
    const [view] = buildOtViews(base, [legacyTakeItem(1)], USER).mine
    expect(view?.ot).toMatchObject({ status: "asignada", assignedToUserId: "u-1" })
    expect(view?.flags).toMatchObject({ canStart: true })
    expect(view?.flags).not.toHaveProperty("canTake")
  })

  it("ingreso pendiente deja la OT en taller con su ingreso, el nombre del taller y los permisos de trabajo", () => {
    const base = WITH({ workOrders: [workOrder()] })
    const start = otOpItem(1, { action: "start", entry: { workshopKind: "externo", workshopId: "w-1", workshopManagerName: "Pedro Silva", operatorDriverId: "d-1", operatorName: null, entryAt: ENTRY.entryAt, odometer: 40_400, hourmeter: null, estimatedDeliveryDate: "2026-10-30" } })
    const [view] = buildOtViews(base, [start], USER).mine
    expect(view?.ot.status).toBe("en_ejecucion")
    expect(view?.ot.entry).toMatchObject({ workshopKind: "externo", workshopName: "Maestranza Melo", estimatedDeliveryDate: "2026-10-30" })
    expect(view?.flags).toMatchObject({ canStart: false, canWork: true, canFinish: false })
  })

  it("marcar ítems, agregar uno del taller y cambiar la fecha se aplican en orden", () => {
    const base = WITH({ workOrders: [workOrder({ status: "en_ejecucion", entry: ENTRY })] })
    const queue = [
      otOpItem(1, { action: "items", marks: [{ itemId: "it-1", done: "si", note: null }, { itemId: "it-2", done: "no", note: "sin aceite" }], added: [{ id: UUID(77), kind: "mantencion", description: "Revisar luces" }] }),
      otOpItem(2, { action: "estimate", estimatedDeliveryDate: "2026-11-02", reason: "Espera repuesto" }),
    ]
    const [view] = buildOtViews(base, queue, USER).mine
    expect(view?.ot.items.map((item) => [item.id, item.done])).toEqual([["it-1", "si"], ["it-2", "no"], [UUID(77), null]])
    expect(view?.ot.items[1]?.note).toBe("sin aceite")
    expect(view?.ot.items[2]).toMatchObject({ origin: "taller", description: "Revisar luces" })
    expect(view?.ot.entry?.estimatedDeliveryDate).toBe("2026-11-02")
    expect(view?.unmarked).toBe(1)
  })

  it("terminar exige todos los ítems marcados y un registro enlazado (enviado o pendiente en la cola)", () => {
    const marked = workOrder({ status: "en_ejecucion", entry: ENTRY, items: workOrder().items.map((item) => ({ ...item, done: "si" as const })) })
    const unmarked = workOrder({ status: "en_ejecucion", entry: ENTRY })

    const [none] = buildOtViews(WITH({ workOrders: [marked] }), [], USER).mine
    expect(none?.flags.canFinish).toBe(false)
    expect(none?.finishBlockers).toEqual(["Registra al menos una correctiva o preventiva de esta OT"])

    const [pendingRecord] = buildOtViews(WITH({ workOrders: [marked] }), [linkedRecord(1)], USER).mine
    expect(pendingRecord?.flags.canFinish).toBe(true)
    expect(pendingRecord?.linked).toEqual([expect.objectContaining({ kind: "C", folio: null, pending: true })])

    const sent = { id: UUID(9), folio: "MC-BIO-0003", kind: "C" as const, signedAt: "2026-10-28T16:00:00.000Z" }
    const [serverRecord] = buildOtViews(WITH({ workOrders: [{ ...marked, linkedRecords: [sent] }] }), [], USER).mine
    expect(serverRecord?.flags.canFinish).toBe(true)

    const [blocked] = buildOtViews(WITH({ workOrders: [unmarked] }), [linkedRecord(1)], USER).mine
    expect(blocked?.flags.canFinish).toBe(false)
    expect(blocked?.finishBlockers).toEqual(["Faltan 2 ítems por marcar con SÍ o NO"])
  })

  it("«terminar» pendiente deja la OT por recibir y ya no permite trabajar", () => {
    const marked = workOrder({ status: "en_ejecucion", entry: ENTRY, items: workOrder().items.map((item) => ({ ...item, done: "si" as const })) })
    const [view] = buildOtViews(WITH({ workOrders: [marked] }), [linkedRecord(1), otOpItem(2, { action: "finish", exitAt: "2026-10-29T12:00:00.000Z", note: null })], USER).mine
    expect(view?.ot).toMatchObject({ status: "trabajo_terminado", exitAt: "2026-10-29T12:00:00.000Z" })
    expect(view?.flags).toMatchObject({ canWork: false, canFinish: false })
  })

  it("una devuelta muestra el motivo y sólo cuenta los registros posteriores a la devolución", () => {
    const returned = workOrder({
      status: "en_ejecucion", entry: ENTRY, items: workOrder().items.map((item) => ({ ...item, done: "si" as const })),
      lastRejection: { count: 1, reason: "Falta apretar la manguera", at: "2026-10-28T17:00:00.000Z" },
    })
    // Recibido por el servidor antes de la devolución: no cuenta, firme lo que firme el teléfono.
    const old = { ...linkedRecord(1, "2026-10-28T16:00:00.000Z"), status: "sent" as const, receivedAt: "2026-10-28T16:01:00.000Z" }
    const [withOld] = buildOtViews(WITH({ workOrders: [returned] }), [old], USER).mine
    expect(withOld?.returnedReason).toBe("Falta apretar la manguera")
    expect(withOld?.linked).toHaveLength(0)
    expect(withOld?.flags.canFinish).toBe(false)
    expect(withOld?.finishBlockers[0]).toMatch(/después de la devolución/)

    const [withNew] = buildOtViews(WITH({ workOrders: [returned] }), [old, linkedRecord(2, "2026-10-28T18:00:00.000Z")], USER).mine
    expect(withNew?.linked).toHaveLength(1)
    expect(withNew?.flags.canFinish).toBe(true)
  })

  it("la devolución se compara con la hora de recepción del servidor, no con la firma del teléfono", () => {
    const returned = workOrder({
      status: "en_ejecucion", entry: ENTRY, items: workOrder().items.map((item) => ({ ...item, done: "si" as const })),
      lastRejection: { count: 1, reason: "Falta apretar la manguera", at: "2026-10-28T17:00:00.000Z" },
    })
    // Teléfono atrasado: firmó «a las 16:00» pero el servidor la recibió a las 17:30, después de la devolución.
    const behind = { ...linkedRecord(1, "2026-10-28T16:00:00.000Z"), status: "sent" as const, receivedAt: "2026-10-28T17:30:00.000Z" }
    expect(buildOtViews(WITH({ workOrders: [returned] }), [behind], USER).mine[0]?.linked).toHaveLength(1)
    // Teléfono adelantado: firmó «a las 18:00» pero el servidor la recibió a las 16:59, antes de la devolución.
    const ahead = { ...linkedRecord(2, "2026-10-28T18:00:00.000Z"), status: "sent" as const, receivedAt: "2026-10-28T16:59:00.000Z" }
    expect(buildOtViews(WITH({ workOrders: [returned] }), [ahead], USER).mine[0]?.linked).toHaveLength(0)
    // Aún en cola: lo recibirá el servidor después de una devolución que el teléfono ya conoce, así que cuenta.
    expect(buildOtViews(WITH({ workOrders: [returned] }), [linkedRecord(3, "2026-10-28T16:00:00.000Z")], USER).mine[0]?.linked).toHaveLength(1)
  })

  it("una operación ya enviada sólo se aplica mientras el catálogo sea más viejo que el envío", () => {
    const sentFinish = { ...otOpItem(2, { action: "finish", exitAt: "2026-10-29T12:00:00.000Z", note: null }), status: "sent" as const, sentAt: "2026-10-29T12:01:00.000Z" }
    const returned = workOrder({ status: "en_ejecucion", entry: ENTRY, lastRejection: { count: 1, reason: "Falta", at: "2026-10-29T15:00:00.000Z" } })
    // Catálogo viejo (anterior al envío): la OT todavía figura en taller y la operación la lleva a «por recibir».
    const stale = buildOtViews({ ...catalog(), generatedAt: "2026-10-29T12:00:30.000Z", workOrders: [returned] }, [sentFinish], USER).mine[0]
    expect(stale?.ot.status).toBe("trabajo_terminado")
    // Catálogo nuevo (posterior): ya trae la devolución y la operación vieja no la pisa.
    const fresh = buildOtViews({ ...catalog(), generatedAt: "2026-10-29T15:05:00.000Z", workOrders: [returned] }, [sentFinish], USER).mine[0]
    expect(fresh?.ot.status).toBe("en_ejecucion")
  })

  it("una operación rechazada no se aplica y se muestra con su motivo; un cambio más nuevo la oculta", () => {
    const rejected = { ...otOpItem(1, { action: "start", entry: { ...ENTRY, workshopId: null, operatorDriverId: null } }), status: "rejected" as const, lastError: "La OT ya no está asignada a ti." }
    const base = WITH({ workOrders: [workOrder()] })
    const [view] = buildOtViews(base, [rejected], USER).mine
    expect(view?.ot.status).toBe("asignada")
    expect(view?.rejected).toEqual([{ id: rejected.id, action: "start", message: "La OT ya no está asignada a ti." }])

    const newer = otOpItem(3, { action: "start", entry: { ...ENTRY, workshopId: null, operatorDriverId: null } })
    expect(buildOtViews(base, [rejected, newer], USER).mine[0]?.rejected).toEqual([])
  })

  it("las operaciones de otra cuenta no tocan mis OT, y una guardia de estado ignora lo que ya no corresponde", () => {
    const base = WITH({ workOrders: [workOrder({ status: "en_ejecucion", entry: ENTRY })] })
    const other = otOpItem(1, { action: "finish", exitAt: "2026-10-29T12:00:00.000Z", note: null }, { authorUserId: "u-2" })
    expect(buildOtViews(base, [other], USER).mine[0]?.ot.status).toBe("en_ejecucion")
    const ctx = { userId: "u-1", userName: "Javier", workshops: [] }
    expect(applyOp(workOrder({ status: "cerrada" }), { action: "take", id: UUID(1), workOrderId: "ot-1", createdAt: "2026-10-28T15:00:00.000Z", deviceId: UUID(900) }, ctx).status).toBe("cerrada")
  })

  it("Mis OT: lo que pide acción va primero y lo cerrado al final", () => {
    const base = WITH({ workOrders: [
      workOrder({ id: "a", folio: "OT-BIO-0001", status: "cerrada" }),
      workOrder({ id: "b", folio: "OT-BIO-0002", status: "asignada" }),
      workOrder({ id: "c", folio: "OT-BIO-0003", status: "en_ejecucion", entry: ENTRY }),
    ] })
    expect(buildOtViews(base, [], USER).mine.map((view) => view.ot.id)).toEqual(["c", "b", "a"])
  })
})

describe("equipo de una OT de otra faena", () => {
  it("se arma desde el resumen de la OT y el teléfono puede registrar trabajo aunque el catálogo liviano no se haya bajado", () => {
    const outside = workOrder({ vehicleId: "veh-9", equipmentCode: "CP-12", equipmentPlate: "CP-12", worksiteId: "ws-ch", worksiteName: "Cholguan", outOfWorksite: true })
    const stored = { ...storedCatalog("u-1"), catalog: { ...catalog(), workOrders: [outside] } }
    const rows = buildRows(stored, [])
    const row = rows.find((entry) => entry.eq.id === "veh-9")
    expect(row).toBeTruthy()
    expect(row?.eq).toMatchObject({ code: "CP-12", noPlate: true, worksiteName: "Cholguan", unit: "km" })
    expect(row?.mine).toBe(false)
    expect(equipmentFromWorkOrder(outside).readings).toEqual([])
  })

  it("si el catálogo liviano ya trae el equipo, manda ese (con sus lecturas) y no se duplica", () => {
    const outside = workOrder({ vehicleId: "veh-9", equipmentCode: "CP-12", worksiteId: "ws-ch" })
    const light = { ...storedCatalog("u-1").catalog.equipment[0]!, id: "veh-9", code: "CP-12", worksiteId: "ws-ch", recentPreventives: [] as [], workshop: null }
    const stored = { ...storedCatalog("u-1"), catalog: { ...catalog(), workOrders: [outside] }, others: { etag: null, version: "o1", equipment: [light], fetchedAt: "2026-10-28T12:00:00.000Z" } }
    const matches = buildRows(stored, []).filter((entry) => entry.eq.id === "veh-9")
    expect(matches).toHaveLength(1)
    expect(matches[0]?.eq.readings.length).toBeGreaterThan(0)
  })
})
