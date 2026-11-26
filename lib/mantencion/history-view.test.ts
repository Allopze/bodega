import { describe, expect, it } from "vitest"
import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import {
  HISTORY_PATH, buildWorkMatrix, countByType, filterHistoryRows, groupHistoryRows, historyHref, historyMonths, matrixCellKind,
  monthRange, parseHistoryParams, resolveHistoryPeriod, sortHistoryRows,
} from "./history-view"

const TODAY = "2026-11-25"

function row(overrides: Partial<MaintenanceHistoryRow> & { detail?: Partial<MaintenanceHistoryRow["detail"]> } = {}): MaintenanceHistoryRow {
  const { detail, ...rest } = overrides
  return {
    id: "h:1",
    source: "historial",
    reference: "",
    date: "2026-11-10",
    vehicleId: "veh-1",
    equipmentLabel: "KA-79 · ABCD12",
    worksiteId: "ws-1",
    worksiteName: "Cholguán",
    actionType: "correctiva",
    laborHours: 4,
    workshopDays: 2,
    inWorkshop: false,
    external: false,
    detail: {
      description: "Cambio de bomba hidráulica", entryDate: "2026-11-10", exitDate: "2026-11-12", reading: "40.312 km", orderText: "29600",
      responsible: null, specialties: ["hidraulica"], contract: null, href: "/mantencion/registros/historicos/abc",
      unlinkedEquipment: false, unlinkedWorksite: false, qualityNotes: null,
      ...detail,
    },
    ...rest,
  }
}

describe("resolveHistoryPeriod", () => {
  it("sin parámetros son los últimos 12 meses, hasta hoy", () => {
    expect(resolveHistoryPeriod({}, TODAY)).toEqual({ from: "2025-12-01", to: TODAY, period: "12m", invalid: false })
  })
  it("`periodo=todo` abre todo el historial hasta hoy", () => {
    expect(resolveHistoryPeriod({ periodo: "todo" }, TODAY)).toMatchObject({ from: "2000-01-01", to: TODAY, period: "todo" })
  })
  it("un rango válido se respeta, pero nunca pasa de hoy", () => {
    expect(resolveHistoryPeriod({ desde: "2026-01-01", hasta: "2027-07-20" }, TODAY)).toEqual({ from: "2026-01-01", to: TODAY, period: "personalizado", invalid: false })
  })
  it("un rango imposible vuelve al período por defecto y lo avisa", () => {
    expect(resolveHistoryPeriod({ desde: "2026-13-40" }, TODAY)).toMatchObject({ period: "12m", invalid: true })
    expect(resolveHistoryPeriod({ desde: "2026-06-01", hasta: "2026-01-01" }, TODAY)).toMatchObject({ period: "12m", invalid: true })
  })
})

describe("parseHistoryParams / historyHref", () => {
  it("lee los valores por defecto", () => {
    const params = parseHistoryParams({}, TODAY)
    expect(params).toMatchObject({ view: "historial", sort: "fecha", dir: "desc", page: 1, source: null, type: null, group: null })
  })
  it("ignora valores desconocidos y acota la búsqueda", () => {
    const params = parseHistoryParams({ origen: "otro", tipo: "x", taller: "z", especialidad: "pintura", orden: "color", q: "a".repeat(300), page: "-4" }, TODAY)
    expect(params).toMatchObject({ source: null, type: null, workshop: null, specialty: null, sort: "fecha", page: 1 })
    expect(params.q).toHaveLength(100)
  })
  it("un enlace con `vinculo` (la conciliación de antes) abre «Respuestas de formularios»", () => {
    expect(parseHistoryParams({ vinculo: "equipment" }, TODAY).view).toBe("formularios")
  })
  it("un rango imposible se marca para que la página lo diga", () => {
    expect(parseHistoryParams({ desde: "2026-13-40" }, TODAY)).toMatchObject({ period: "12m", periodInvalid: true })
    expect(parseHistoryParams({ desde: "2026-01-01", hasta: "2026-03-31" }, TODAY).periodInvalid).toBe(false)
    expect(parseHistoryParams({}, TODAY).periodInvalid).toBe(false)
  })
  it("el enlace por defecto no lleva parámetros", () => {
    expect(historyHref(parseHistoryParams({}, TODAY))).toBe(HISTORY_PATH)
  })
  it("cambiar un filtro o el orden vuelve a la página 1; sólo cambiar de página la conserva", () => {
    const params = parseHistoryParams({ page: "3", tipo: "correctiva" }, TODAY)
    expect(historyHref(params, { source: "ot" })).toBe(`${HISTORY_PATH}?origen=ot&tipo=correctiva`)
    expect(historyHref(params, { sort: "horas" })).toBe(`${HISTORY_PATH}?tipo=correctiva&orden=horas`)
    expect(historyHref(params, { page: 4 })).toBe(`${HISTORY_PATH}?tipo=correctiva&page=4`)
  })
  it("un enlace armado se lee igual", () => {
    const params = parseHistoryParams({ vista: "matriz", faena: "ws-1", periodo: "todo", tipo: "correctiva", taller: "externo", especialidad: "electrica", orden: "dias", dir: "desc", agrupar: "equipo", q: "bomba" }, TODAY)
    expect(parseHistoryParams(Object.fromEntries(new URL(`http://x${historyHref(params)}`).searchParams), TODAY)).toEqual(params)
  })
  it("`periodo=todo` gana sobre un desde/hasta que venga con él", () => {
    const params = parseHistoryParams({ periodo: "todo", desde: "2026-03-01", hasta: "2026-03-31" }, TODAY)
    expect(params).toMatchObject({ period: "todo", from: "2000-01-01", to: TODAY })
    expect(historyHref(params)).toBe(`${HISTORY_PATH}?periodo=todo`)
  })
  it("un desde sin hasta llega hasta hoy y el enlace armado se lee igual", () => {
    const params = parseHistoryParams({ desde: "2026-03-01" }, TODAY)
    expect(params).toMatchObject({ period: "personalizado", from: "2026-03-01", to: TODAY })
    expect(parseHistoryParams(Object.fromEntries(new URL(`http://x${historyHref(params)}`).searchParams), TODAY)).toEqual(params)
  })
  it("quitar un filtro con null lo saca del enlace", () => {
    const params = parseHistoryParams({ tipo: "correctiva", equipo: "veh-1" }, TODAY)
    expect(historyHref(params, { vehicleId: null })).toBe(`${HISTORY_PATH}?tipo=correctiva`)
  })
  it("un período personalizado viaja como desde/hasta", () => {
    const params = parseHistoryParams({ desde: "2026-03-01", hasta: "2026-03-31" }, TODAY)
    expect(historyHref(params)).toBe(`${HISTORY_PATH}?desde=2026-03-01&hasta=2026-03-31`)
  })
})

describe("filterHistoryRows", () => {
  const rows = [
    row({ id: "h:1" }),
    row({ id: "ot:1", source: "ot", actionType: "preventiva", external: true, detail: { description: "Cambio de aceite y filtros", specialties: ["mecanica"], responsible: "MAESTRANZA MELO" } as never }),
    row({ id: "r:1", source: "registro", actionType: "sin_clasificar", external: null, equipmentLabel: "GR-11", detail: { description: "Revisión", specialties: [] } as never }),
  ]
  const params = (raw: Record<string, string>) => parseHistoryParams(raw, TODAY)

  it("busca sin distinguir tildes ni mayúsculas, en el trabajo, el taller y el equipo", () => {
    expect(filterHistoryRows(rows, params({ q: "HIDRAULICA" })).map((r) => r.id)).toEqual(["h:1"])
    expect(filterHistoryRows(rows, params({ q: "maestranza" })).map((r) => r.id)).toEqual(["ot:1"])
    expect(filterHistoryRows(rows, params({ q: "gr-11" })).map((r) => r.id)).toEqual(["r:1"])
  })
  it("encuentra el folio de la OT y del registro firmado, con o sin guiones, espacios y mayúsculas", () => {
    const folios = [
      row({ id: "ot:1", source: "ot", reference: "OT-BIO-0001" }),
      row({ id: "r:1", source: "registro", reference: "MP-STF-0147", equipmentLabel: "KA-91 · BCDF12" }),
      row({ id: "h:1", reference: "MT-00031" }),
    ]
    const found = (q: string) => filterHistoryRows(folios, params({ q })).map((r) => r.id)
    for (const q of ["MP-STF-0147", "mp-stf-0147", "mpstf0147", "mp stf 0147", "stf0147"]) expect(found(q), q).toEqual(["r:1"])
    for (const q of ["OT-BIO-0001", "otbio0001", "ot bio 0001"]) expect(found(q), q).toEqual(["ot:1"])
    expect(found("mt00031")).toEqual(["h:1"])
    // El equipo también: «ka91» encuentra «KA-91 · BCDF12», y «ka91bcdf12» el equipo con su patente.
    expect(found("ka91")).toEqual(["r:1"])
    expect(found("KA 91")).toEqual(["r:1"])
    expect(found("ka91bcdf12")).toEqual(["r:1"])
    expect(found("kb91")).toEqual([])
  })
  it("la comparación sin guiones no cruza de un campo a otro ni compacta el texto libre", () => {
    const rows = [row({ id: "r:1", reference: "MP-AB", equipmentLabel: "CD-1", detail: { description: "Cambio de bomba", orderText: null } as never })]
    // «abcd» saldría de pegar el folio con el equipo; «iodeb», de quitar los espacios de la descripción.
    expect(filterHistoryRows(rows, params({ q: "abcd" }))).toEqual([])
    expect(filterHistoryRows(rows, params({ q: "iodeb" }))).toEqual([])
    expect(filterHistoryRows(rows, params({ q: "cambio de bomba" })).map((r) => r.id)).toEqual(["r:1"])
  })
  it("filtra por origen, tipo, taller y especialidad", () => {
    expect(filterHistoryRows(rows, params({ origen: "ot" })).map((r) => r.id)).toEqual(["ot:1"])
    expect(filterHistoryRows(rows, params({ tipo: "sin_clasificar" })).map((r) => r.id)).toEqual(["r:1"])
    expect(filterHistoryRows(rows, params({ taller: "externo" })).map((r) => r.id)).toEqual(["ot:1"])
    expect(filterHistoryRows(rows, params({ taller: "interno" })).map((r) => r.id)).toEqual(["h:1"])
    expect(filterHistoryRows(rows, params({ especialidad: "mecanica" })).map((r) => r.id)).toEqual(["ot:1"])
  })
  it("`skip: type` deja el tipo sin aplicar para contar el selector con los demás filtros puestos", () => {
    const withType = params({ tipo: "correctiva", origen: "historial" })
    expect(filterHistoryRows(rows, withType)).toHaveLength(1)
    expect(countByType(filterHistoryRows(rows, withType, "type"))).toEqual({ correctiva: 1, preventiva: 0, predictiva: 0, sin_clasificar: 0 })
  })
})

describe("sortHistoryRows / groupHistoryRows", () => {
  const rows = [
    row({ id: "a", date: "2026-10-01", laborHours: null, workshopDays: 5, equipmentLabel: "KA-10", actionType: "preventiva", vehicleId: "veh-10" }),
    row({ id: "b", date: "2026-11-01", laborHours: 8, workshopDays: null, equipmentLabel: "KA-2", actionType: "correctiva" }),
    row({ id: "c", date: "2026-11-01", laborHours: 2, workshopDays: 1, equipmentLabel: "KA-1", actionType: "correctiva", vehicleId: null }),
  ]
  it("ordena por fecha desc con un empate estable", () => {
    expect(sortHistoryRows(rows, "fecha", "desc").map((r) => r.id)).toEqual(["c", "b", "a"])
  })
  it("ordena por equipo de forma natural (KA-2 antes que KA-10)", () => {
    expect(sortHistoryRows(rows, "equipo", "asc").map((r) => r.equipmentLabel)).toEqual(["KA-1", "KA-2", "KA-10"])
  })
  it("lo sin dato (horas o días) va siempre al final, suba o baje el orden", () => {
    expect(sortHistoryRows(rows, "horas", "desc").map((r) => r.id)).toEqual(["b", "c", "a"])
    expect(sortHistoryRows(rows, "horas", "asc").map((r) => r.id)).toEqual(["c", "b", "a"])
    expect(sortHistoryRows(rows, "dias", "asc").map((r) => r.id)).toEqual(["c", "a", "b"])
    expect(sortHistoryRows(rows, "dias", "desc").map((r) => r.id)).toEqual(["a", "c", "b"])
  })
  it("con varias filas sin dato, el empate sigue siendo estable (fecha más reciente, equipo, id)", () => {
    const empty = [row({ id: "x", laborHours: null, date: "2026-10-01" }), row({ id: "y", laborHours: null, date: "2026-11-01" }), row({ id: "z", laborHours: 2 })]
    expect(sortHistoryRows(empty, "horas", "asc").map((r) => r.id)).toEqual(["z", "y", "x"])
  })
  it("ordena por tipo: correctivas primero", () => {
    expect(sortHistoryRows(rows, "tipo", "asc").map((r) => r.actionType)).toEqual(["correctiva", "correctiva", "preventiva"])
  })
  it("agrupa por mes y por equipo conservando el orden", () => {
    const sorted = sortHistoryRows(rows, "fecha", "desc")
    expect(groupHistoryRows(sorted, "mes").map((g) => [g.key, g.rows.length])).toEqual([["2026-11", 2], ["2026-10", 1]])
    const byEquipment = groupHistoryRows(sorted, "equipo")
    expect(byEquipment.map((g) => g.label)).toEqual(["Equipo sin identificar", "KA-2", "KA-10"])
  })
})

describe("historyMonths", () => {
  it("devuelve al menos 6 meses terminando en el de `to`", () => {
    expect(historyMonths("2026-11-01", "2026-11-25")).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"])
  })
  it("respeta un período más largo, hasta 14 meses", () => {
    expect(historyMonths("2025-12-01", "2026-11-25")).toHaveLength(12)
    const all = historyMonths("2000-01-01", "2026-11-25")
    expect(all).toHaveLength(14)
    expect(all.at(-1)).toBe("2026-11")
  })
  it("monthRange da el primer y el último día", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
})

describe("buildWorkMatrix", () => {
  const months = ["2026-09", "2026-10", "2026-11"]
  it("cuenta por equipo y mes, ignora meses fuera y avisa los trabajos sin equipo", () => {
    const matrix = buildWorkMatrix([
      row({ id: "1", date: "2026-09-02", actionType: "preventiva" }),
      row({ id: "2", date: "2026-09-20", actionType: "correctiva" }),
      row({ id: "3", date: "2026-11-01", actionType: "correctiva" }),
      row({ id: "4", date: "2026-01-01", actionType: "correctiva" }),
      row({ id: "5", date: "2026-10-05", vehicleId: null, equipmentLabel: "WX-6495" }),
    ], months)
    expect(matrix.withoutEquipment).toBe(1)
    expect(matrix.rows).toHaveLength(1)
    const [equipment] = matrix.rows
    expect(equipment).toMatchObject({ vehicleId: "veh-1", total: 3, correctives: 2 })
    expect(equipment!.cells["2026-09"]).toMatchObject({ total: 2, preventiva: 1, correctiva: 1 })
    expect(equipment!.cells["2026-10"]).toBeUndefined()
    expect(matrix.maxCell).toBe(2)
    expect(matrixCellKind(equipment!.cells["2026-09"]!)).toBe("mixta")
    expect(matrixCellKind(equipment!.cells["2026-11"]!)).toBe("correctiva")
  })
  it("con tope conserva los equipos con más correctivas y dice cuántos quedaron fuera", () => {
    const rows = ["A", "B", "C"].flatMap((name, index) => Array.from({ length: index + 1 }, (_, n) => row({ id: `${name}${n}`, vehicleId: name, equipmentLabel: name, date: "2026-11-02", actionType: "correctiva" })))
    const matrix = buildWorkMatrix(rows, months, 2)
    expect(matrix.hiddenRows).toBe(1)
    expect(matrix.rows.map((r) => r.vehicleId).sort()).toEqual(["B", "C"])
  })
  it("agrupa por faena y deja «sin faena» al final", () => {
    const matrix = buildWorkMatrix([
      row({ id: "1", vehicleId: "x", equipmentLabel: "X", worksiteName: null }),
      row({ id: "2", vehicleId: "y", equipmentLabel: "Y", worksiteName: "Santa Fe" }),
      row({ id: "3", vehicleId: "z", equipmentLabel: "Z", worksiteName: "Biodiversa" }),
    ], months)
    expect(matrix.rows.map((r) => r.vehicleId)).toEqual(["z", "y", "x"])
  })
})
