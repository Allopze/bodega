import { describe, expect, it } from "vitest"
import { buildRows, dueRows, filterForPicking, searchKey, workshopEntries } from "../fleet-view"
import { buildRecent, openObservations, shortWhen, worksiteSummary } from "../home-model"
import { newReplyItem, newWorkshopItem } from "../queue"
import type { QueueItem } from "../types"
import { UUID, catalog, equipment, recordItem, storedCatalog } from "./fixtures"

const NOW = Date.parse("2026-10-28T18:00:00.000Z")

describe("flota en el teléfono", () => {
  it("vencidos y próximos primero; el resto por código", () => {
    const stored = storedCatalog("u-1", [
      equipment({ id: "a", code: "KA-141", state: "al_dia", remaining: 8000, nextReading: 50_000 }),
      equipment({ id: "b", code: "KA-142", state: "proxima", remaining: 900, nextReading: 41_000 }),
      equipment({ id: "c", code: "KA-143", state: "vencida", remaining: -300, nextReading: 40_000 }),
      equipment({ id: "d", code: "KA-140", state: "al_dia", remaining: 9000, nextReading: 50_000 }),
    ])
    const rows = filterForPicking(buildRows(stored, []), { scope: "mine", query: "" })
    expect(rows.map((row) => row.eq.code)).toEqual(["KA-143", "KA-142", "KA-140", "KA-141"])
  })

  it("busca por patente o código sin tildes, guiones ni mayúsculas", () => {
    const rows = buildRows(storedCatalog("u-1", [equipment({ code: "KA-140", plate: "SGCP-84" }), equipment({ id: "v2", code: "KCH-133", plate: "SRCJ-47" })]), [])
    expect(searchKey("ka 140")).toBe("ka140")
    expect(filterForPicking(rows, { scope: "mine", query: "sgcp84" }).map((row) => row.eq.code)).toEqual(["KA-140"])
    expect(filterForPicking(rows, { scope: "mine", query: "kch" }).map((row) => row.eq.code)).toEqual(["KCH-133"])
    expect(filterForPicking(rows, { scope: "mine", query: "zzz" })).toEqual([])
  })

  it("«Todas las faenas» suma los equipos livianos de la segunda carga", () => {
    const stored = storedCatalog()
    stored.others = { etag: '"o1"', version: "o1", fetchedAt: "2026-10-28T12:00:00.000Z", equipment: [{ ...equipment({ id: "otro", code: "CR-31", worksiteId: "ws-otro", worksiteName: "Cabrero" }), recentPreventives: [], workshop: null }] }
    const rows = buildRows(stored, [])
    expect(filterForPicking(rows, { scope: "mine", query: "" }).map((row) => row.eq.code)).toEqual(["KA-140"])
    expect(filterForPicking(rows, { scope: "all", query: "" }).map((row) => row.eq.code).sort()).toEqual(["CR-31", "KA-140"])
  })

  it("«Le toca mantención»: sólo vencidos y próximos de MI faena", () => {
    const stored = storedCatalog("u-1", [
      equipment({ id: "a", code: "KA-141", state: "al_dia" }),
      equipment({ id: "b", code: "KA-142", state: "vencida" }),
      equipment({ id: "c", code: "KA-143", state: "vencida", worksiteId: "ws-otro" }),
    ])
    expect(dueRows(buildRows(stored, [])).map((row) => row.eq.code)).toEqual(["KA-142"])
  })

  it("una preventiva hecha sin señal ya cuenta: la lectura sube y el equipo deja de tocar", () => {
    const stored = storedCatalog("u-1", [equipment({ readings: [{ value: 39_000, date: "2026-10-01", source: "MP-BIO-0001" }], state: "proxima", remaining: 1000, nextReading: 40_000 })])
    const pending = recordItem(UUID(1), "u-1", [UUID(11), UUID(12)])
    const [row] = buildRows(stored, [pending])
    expect(row?.status.currentReading?.value).toBe(40_312)
    expect(row?.status.state).toBe("al_dia")
    // Regla 6: próxima = punto sugerido de la última preventiva (40.000) + intervalo base (10.000).
    expect(row?.status.nextReading).toBe(50_000)
    // …y una segunda preventiva igual se detecta como repetida (regla 7) aunque el servidor no la conozca todavía.
    expect(row?.recentPreventives.map((entry) => entry.id)).toContain(UUID(1))
  })

  it("un registro rechazado no cuenta para las lecturas", () => {
    const stored = storedCatalog("u-1", [equipment({ readings: [{ value: 39_000, date: "2026-10-01", source: "x" }] })])
    const rejected = { ...recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), status: "rejected" as const }
    expect(buildRows(stored, [rejected])[0]?.status.currentReading?.value).toBe(39_000)
  })
})

describe("equipos en taller", () => {
  const inWorkshop = equipment({ workshop: { recordId: UUID(50), folio: "MC-BIO-0003", entryDate: "2026-10-24", lastActivityDate: "2026-10-24", stale: true, daysStopped: 4 } })
  const rows = buildRows(storedCatalog("u-1", [inWorkshop]), [])
  const update = (kind: "sigue" | "salio", createdAt: string) => newWorkshopItem({
    authorUserId: "u-1",
    payload: kind === "sigue"
      ? { id: UUID(60), recordId: UUID(50), kind, note: "Esperando repuesto", createdAt, deviceId: UUID(900) }
      : { id: UUID(61), recordId: UUID(50), kind, exitDate: "2026-10-28", createdAt, deviceId: UUID(900) },
    summary: { vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84" },
  }, createdAt)

  it("aparece con los días detenido y el aviso de actualizar", () => {
    const [entry] = workshopEntries(rows, [], "2026-10-28")
    expect(entry).toMatchObject({ equipmentCode: "KA-140", daysStopped: 4, stale: true })
  })

  it("una actualización «sigue» hecha en el teléfono quita el aviso, sin esperar al servidor", () => {
    const [entry] = workshopEntries(rows, [update("sigue", "2026-10-28T15:00:00.000Z")], "2026-10-28")
    expect(entry?.stale).toBe(false)
  })

  it("una actualización «salió» lo saca de la lista", () => {
    expect(workshopEntries(rows, [update("salio", "2026-10-28T15:00:00.000Z")], "2026-10-28")).toEqual([])
  })

  it("una correctiva firmada sin señal con el equipo en taller aparece antes de llegar al servidor", () => {
    const corrective = { ...recordItem(UUID(70), "u-1", [UUID(71), UUID(72)]), summary: { ...recordItem(UUID(70), "u-1", [UUID(71), UUID(72)]).summary, kind: "C" as const, intervalValue: null, inWorkshop: true, workshopEntryDate: "2026-10-28" } }
    const plain = buildRows(storedCatalog("u-1", [equipment()]), [corrective])
    expect(workshopEntries(plain, [corrective], "2026-10-28").map((entry) => entry.recordId)).toEqual([UUID(70)])
  })
})

describe("inicio: mis registros y observaciones", () => {
  it("mezcla lo del servidor con lo del teléfono, sin repetir y con el más reciente primero", () => {
    const cat = catalog("u-1")
    cat.myRecords = [
      { id: UUID(1), folio: "MP-BIO-0001", kind: "P", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", workDate: "2026-10-20", receivedAt: "2026-10-20T15:00:00.000Z", status: "vigente", review: "pendiente", intervalValue: 20_000, unit: "km" },
      { id: UUID(2), folio: "MC-BIO-0002", kind: "C", equipmentCode: "KA-141", equipmentPlate: "SGCP-77", workDate: "2026-10-22", receivedAt: "2026-10-22T15:00:00.000Z", status: "anulado", review: "pendiente", intervalValue: null, unit: "km" },
    ]
    const sentLocally = { ...recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), status: "sent" as const, folio: "MP-BIO-0001" }
    const pending = recordItem(UUID(3), "u-1", [UUID(21), UUID(22)], "2026-10-28T16:00:00.000Z")
    const otherAuthor = recordItem(UUID(4), "u-2", [UUID(31), UUID(32)], "2026-10-28T17:00:00.000Z")
    const rows = buildRecent(cat, [sentLocally, pending, otherAuthor], "u-1")
    expect(rows.map((row) => row.id)).toEqual([UUID(3), UUID(2), UUID(1)])
    expect(rows[0]).toMatchObject({ state: "pending", folio: null, title: "Preventiva 40.000 km" })
    expect(rows[1]).toMatchObject({ state: "sent", voided: true })
  })

  it("«hoy 14:05» si es de hoy y la fecha dd-mm-aaaa si no", () => {
    expect(shortWhen("2026-10-28T17:05:00.000Z", NOW)).toMatch(/^hoy \d{2}:\d{2}$/)
    expect(shortWhen("2026-10-20T17:05:00.000Z", NOW)).toBe("20-10-2026")
    expect(shortWhen("no es fecha", NOW)).toBe("")
  })

  it("las observaciones esperan hasta que se responden, también con una respuesta guardada en el teléfono", () => {
    const cat = catalog("u-1")
    cat.observations = [
      { id: "o1", recordId: UUID(1), folio: "MP-BIO-0001", equipmentCode: "KA-140", text: "Falta foto del sticker", by: "Alexis", createdAt: "2026-10-27T12:00:00.000Z", response: null },
      { id: "o2", recordId: UUID(2), folio: "MC-BIO-0002", equipmentCode: "KA-141", text: "Revisa las horas", by: "Alexis", createdAt: "2026-10-27T13:00:00.000Z", response: "Corregido" },
    ]
    expect(openObservations(cat, []).map((entry) => entry.id)).toEqual(["o1"])
    const reply: QueueItem = newReplyItem({ authorUserId: "u-1", payload: { observationId: "o1", response: "Ya la subí" }, summary: { folio: null, equipmentCode: "KA-140" } }, UUID(80))
    expect(openObservations(cat, [reply])).toEqual([])
  })
})

describe("faenas del encabezado", () => {
  it("una faena dice su nombre; varias, cuántas son; ninguna, nada", () => {
    expect(worksiteSummary([])).toBeNull()
    expect(worksiteSummary(["Biodiversa"])).toEqual({ text: "Faena Biodiversa", many: false })
    expect(worksiteSummary(["Biodiversa", "Mininco", "Arauco", "Cañete", "Mulchén", "Nacimiento"])).toEqual({ text: "6 faenas", many: true })
    expect(worksiteSummary(["Biodiversa", "Mininco"])?.text).toBe("2 faenas")
  })
})
