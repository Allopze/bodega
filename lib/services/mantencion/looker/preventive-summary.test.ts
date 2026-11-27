import { describe, expect, it } from "vitest"
import {
  averagePercent, compareEquipmentRows, matrixCellShort, matrixCellText, matrixRows, parseLevelValue, percentFromCounts,
  summarizeCompliance,
} from "./preventive-summary"
import type { ComplianceByPlate, ComplianceCheck, MatrixCheck } from "./types"

function check(overrides: Partial<ComplianceCheck> = {}): ComplianceCheck {
  return {
    id: "h:1",
    source: "historial",
    date: "2026-10-03",
    month: "2026-10",
    vehicleId: "v-1",
    code: "KA-143",
    plate: "SJFC-66",
    worksiteId: "ws-1",
    worksiteName: "Teno",
    level: "40.000 KM",
    levelValue: 40_000,
    mechanic: "Javier Roa",
    mechanicKey: "javier roa",
    done: 39,
    notDone: 1,
    notApplicable: 9,
    percent: 97.5,
    photosComplete: true,
    ...overrides,
  }
}

describe("Preventivo · porcentajes", () => {
  it("lee el nivel de la pauta desde su etiqueta", () => {
    expect(parseLevelValue("40.000 KM")).toBe(40_000)
    expect(parseLevelValue("900 HRS")).toBe(900)
    expect(parseLevelValue("Pauta")).toBeNull()
    expect(parseLevelValue(null)).toBeNull()
  })

  it("calcula R / (R + NR) y deja fuera NA", () => {
    expect(percentFromCounts(38, 0, null)).toBe(100)
    expect(percentFromCounts(39, 2, null)).toBeCloseTo(95.12, 2)
    expect(percentFromCounts(0, 0, 0.95)).toBeCloseTo(95, 5)
    expect(percentFromCounts(0, 0, null)).toBeNull()
  })

  it("promedia sólo los valores medidos", () => {
    expect(averagePercent([100, 50, null])).toBe(75)
    expect(averagePercent([null, null])).toBeNull()
    expect(averagePercent([95.12, 97.44])).toBe(96.3)
  })
})

describe("Preventivo · agregados", () => {
  const checks = [
    check({ id: "h:1", date: "2026-10-03", month: "2026-10", percent: 100, done: 40, notDone: 0, level: "40.000 KM", levelValue: 40_000 }),
    check({ id: "h:2", date: "2026-10-20", month: "2026-10", percent: 90, done: 9, notDone: 1, mechanic: "Pedro Soto", mechanicKey: "pedro soto" }),
    check({ id: "h:3", date: "2026-11-04", month: "2026-11", percent: null, done: 0, notDone: 0, level: "80.000 KM", levelValue: 80_000, worksiteId: "ws-2", worksiteName: "Arauco" }),
  ]

  it("el mes es el promedio de los % de cada pauta, no el cociente de los totales", () => {
    const result = summarizeCompliance(checks, "2026-10-01", "2026-11-30")
    expect(result.byMonth.map((bucket) => bucket.key)).toEqual(["2026-10", "2026-11"])
    expect(result.byMonth[0]).toMatchObject({ percent: 95, checks: 2 })
    expect(result.byMonth[1]).toMatchObject({ percent: null, checks: 1 })
    expect(result.average).toBe(95)
    expect(result.total).toBe(3)
  })

  it("agrupa por faena y mecánico, y por patente con sus niveles", () => {
    const result = summarizeCompliance(checks, "2026-10-01", "2026-11-30")
    expect(result.byWorksiteMechanic).toHaveLength(3)
    const teno = result.byWorksiteMechanic.find((bucket) => bucket.mechanicKey === "javier roa")
    expect(teno).toMatchObject({ percent: 100, checks: 1, worksiteId: "ws-1", worksiteName: "Teno", mechanicLabel: "Javier Roa" })
    expect(result.byPlate).toHaveLength(1)
    expect(result.byPlate[0]).toMatchObject({ code: "KA-143", percent: 95, checks: 3 })
    expect(result.byPlate[0]!.levels.sort()).toEqual(["40.000 KM", "80.000 KM"])
  })

  it("por equipo suma lo no realizado, toma la última pauta y cuenta las que no traen las dos fotos", () => {
    const result = summarizeCompliance([
      check({ id: "h:1", date: "2026-10-03", notDone: 2, mechanic: "Pedro Soto", mechanicKey: "pedro soto" }),
      check({ id: "h:2", date: "2026-11-04", notDone: 1, photosComplete: false }),
      check({ id: "h:3", date: "2026-10-20", notDone: 0, photosComplete: false }),
    ], "2026-10-01", "2026-11-30")
    expect(result.byPlate[0]).toMatchObject({
      notDone: 3, lastDate: "2026-11-04", lastMechanic: "Javier Roa", withoutPhotos: 2, checks: 3,
    })
    expect(result.notDone).toBe(3)
    expect(result.withoutPhotos).toBe(2)
  })

  it("faena y mecánico va con el % más bajo primero y deja al final lo que no tiene dato", () => {
    const result = summarizeCompliance([
      check({ id: "h:1", percent: 100, worksiteId: "ws-1", worksiteName: "Teno" }),
      check({ id: "h:2", percent: 60, worksiteId: "ws-2", worksiteName: "Arauco", mechanic: "Pedro Soto", mechanicKey: "pedro soto" }),
      check({ id: "h:3", percent: null, worksiteId: "ws-3", worksiteName: "Cabrero", mechanic: "Ana Mora", mechanicKey: "ana mora" }),
    ], "2026-10-01", "2026-10-31")
    expect(result.byWorksiteMechanic.map((bucket) => bucket.worksiteName)).toEqual(["Arauco", "Teno", "Cabrero"])
  })
})

describe("Cumplimiento por equipo · orden", () => {
  const row = (over: Partial<ComplianceByPlate>): ComplianceByPlate => ({
    vehicleId: "v", code: "KA-1", plate: "AA-11", worksiteId: null, worksiteName: null, percent: 100, checks: 1, levels: [],
    notDone: 0, lastDate: null, lastMechanic: null, withoutPhotos: 0, ...over,
  })

  it("primero los que tienen más ítems sin hacer; a igual cantidad, el menor %; luego el código", () => {
    const rows = [
      row({ code: "KA-2", notDone: 0, percent: 100 }),
      row({ code: "KA-3", notDone: 1, percent: 90 }),
      row({ code: "KA-1", notDone: 5, percent: 80 }),
      row({ code: "KA-4", notDone: 1, percent: 70 }),
      row({ code: "KA-10", notDone: 0, percent: 100 }),
      row({ code: "KA-5", notDone: 0, percent: null }),
    ]
    expect(rows.sort(compareEquipmentRows).map((item) => item.code)).toEqual(["KA-1", "KA-4", "KA-3", "KA-2", "KA-10", "KA-5"])
  })
})

describe("Matriz de checklist", () => {
  const matrixCheck = (overrides: Partial<MatrixCheck> = {}): MatrixCheck => ({
    id: "h:1",
    source: "historial",
    date: "2026-10-03",
    vehicleId: "v-1",
    label: "KA-143 · 40.000 KM",
    code: "KA-143",
    plate: "SJFC-66",
    worksiteName: "Teno",
    level: "40.000 KM",
    mechanic: "Javier Roa",
    photoIds: [],
    photoUrls: [],
    observations: null,
    items: {
      "Cambio aceite motor": "realizado",
      "Cambio filtro aire motor": "no_realizado",
      "Revisión fugas": "no_aplica",
    },
    itemOrder: { "Cambio aceite motor": 0, "Cambio filtro aire motor": 1, "Revisión fugas": 2 },
    itemGroups: { "Cambio aceite motor": "Motor", "Cambio filtro aire motor": "Motor", "Revisión fugas": null },
    ...overrides,
  })

  it("ordena las filas por la pauta más reciente y agrega los ítems que sólo trae otra", () => {
    const first = matrixCheck()
    const second = matrixCheck({
      id: "h:2",
      date: "2026-09-01",
      items: { "Cambio aceite motor": "realizado", "Revisión frenos": "no_aplica" },
      itemOrder: { "Cambio aceite motor": 0, "Revisión frenos": 1 },
      itemGroups: { "Cambio aceite motor": "Motor", "Revisión frenos": "Frenos" },
    })
    expect(matrixRows([first, second]).map((item) => item.name)).toEqual([
      "Cambio aceite motor", "Cambio filtro aire motor", "Revisión fugas", "Revisión frenos",
    ])
    expect(matrixRows([first, second])[3]!.group).toBe("Frenos")
  })

  it("rotula cada estado, incluido el ítem que no está en esa pauta", () => {
    expect(matrixCellShort("realizado")).toBe("R")
    expect(matrixCellShort("no_realizado")).toBe("NR")
    expect(matrixCellShort("no_aplica")).toBe("NA")
    expect(matrixCellShort(undefined)).toBe("—")
    expect(matrixCellText("no_realizado")).toBe("No realizado")
    expect(matrixCellText(undefined)).toBe("No está en esta pauta")
  })
})
