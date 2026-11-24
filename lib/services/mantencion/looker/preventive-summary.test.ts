import { describe, expect, it } from "vitest"
import {
  averagePercent, matrixCellShort, matrixCellText, matrixRows, parseLevelValue, percentFromCounts, summarizeCompliance,
} from "./preventive-summary"
import type { ComplianceCheck, MatrixCheck } from "./types"

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
})

describe("Matriz de checklist", () => {
  const matrixCheck = (overrides: Partial<MatrixCheck> = {}): MatrixCheck => ({
    id: "h:1",
    source: "historial",
    date: "2026-10-03",
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
