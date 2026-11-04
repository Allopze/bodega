import { describe, expect, it } from "vitest"
import type { VehicleEvolutionPoint } from "../consumption-dashboard"
import { buildEvolutionPanels, describeEvolution, evolutionTable } from "../evolution-panels"

/**
 * Evolución por equipo como *small multiples*: un panel por equipo, todos con la misma escala vertical para que se puedan
 * comparar de un vistazo. No hay un color por equipo —el título del panel lo identifica— y por eso tampoco se recicla una paleta.
 */

const point = (plate: string, periodo: string, liters: number, extra: Partial<VehicleEvolutionPoint> = {}): VehicleEvolutionPoint => ({
  periodo, plate, vehicleCode: null, vehicleId: `veh-${plate}`, liters, amount: null, ...extra,
})

describe("buildEvolutionPanels", () => {
  const points = [
    point("AA-1111", "2026-07-01", 500), point("AA-1111", "2026-08-01", 700), point("AA-1111", "2026-09-01", 900),
    point("BB-2222", "2026-07-01", 200), point("BB-2222", "2026-09-01", 300),
    point("CC-3333", "2026-08-01", 50),
  ]

  it("un panel por equipo, del que más consume al que menos, con su total", () => {
    const { panels } = buildEvolutionPanels(points)

    expect(panels.map((panel) => [panel.plate, panel.total])).toEqual([["AA-1111", 2_100], ["BB-2222", 500], ["CC-3333", 50]])
  })

  it("todos los paneles comparten el eje del tiempo: el período sin registros es un hueco (null), no un 0 inventado", () => {
    const { periods, panels } = buildEvolutionPanels(points)

    expect(periods).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"])
    expect(panels[1]!.series).toEqual([
      { periodo: "2026-07-01", liters: 200 },
      { periodo: "2026-08-01", liters: null },
      { periodo: "2026-09-01", liters: 300 },
    ])
  })

  it("todos comparten la escala vertical: el tope cubre al mayor valor de cualquier panel", () => {
    const { axisMax } = buildEvolutionPanels(points)

    expect(axisMax).toBeGreaterThanOrEqual(900)
    expect(axisMax).toBeLessThanOrEqual(1_200)
  })

  it("con más equipos que paneles muestra los que más consumen y dice cuántos quedaron fuera y qué parte del total representan", () => {
    const many = Array.from({ length: 10 }, (_, index) => [
      point(`EQ-${index}`, "2026-07-01", 1_000 - index * 10),
      point(`EQ-${index}`, "2026-08-01", 1_000 - index * 10),
    ]).flat()
    const result = buildEvolutionPanels(many, 4)

    expect(result.panels.map((panel) => panel.plate)).toEqual(["EQ-0", "EQ-1", "EQ-2", "EQ-3"])
    expect(result.hiddenCount).toBe(6)
    expect(result.totalEquipment).toBe(10)
    expect(result.shownLiters).toBe(2 * (1_000 + 990 + 980 + 970))
    expect(result.allLiters).toBe(2 * (10 * 1_000 - 10 * 45))
  })

  it("el período que sólo tienen los equipos que no se muestran no deja una columna vacía en cada panel", () => {
    const result = buildEvolutionPanels([
      point("AA-1", "2026-07-01", 900), point("AA-1", "2026-08-01", 900),
      point("BB-2", "2026-09-01", 5), point("BB-2", "2026-10-01", 5),
    ], 1)

    expect(result.periods).toEqual(["2026-07-01", "2026-08-01"])
  })

  it("el rótulo lleva el código del equipo si lo tiene, y la patente si no", () => {
    const { panels } = buildEvolutionPanels([point("AA-1111", "2026-07-01", 10, { vehicleCode: "KA-1" }), point("BB-2222", "2026-07-01", 5)])

    expect(panels.map((panel) => panel.label)).toEqual(["KA-1 · AA-1111", "BB-2222"])
  })

  it("sin equipo asociado (patente fuera de la flota) no hay ficha a la que enlazar", () => {
    const { panels } = buildEvolutionPanels([point("ZZ-9999", "2026-07-01", 10, { vehicleId: null })])

    expect(panels[0]!.vehicleId).toBeNull()
  })

  it("suma los registros del mismo equipo y período (dos tarjetas de una misma patente)", () => {
    const { panels } = buildEvolutionPanels([point("AA-1", "2026-07-01", 100), point("AA-1", "2026-07-01", 50)])

    expect(panels[0]!.series).toEqual([{ periodo: "2026-07-01", liters: 150 }])
  })

  it("desempata por rótulo para que el orden no cambie entre cargas", () => {
    const { panels } = buildEvolutionPanels([point("BB", "2026-07-01", 10), point("AA", "2026-07-01", 10)])

    expect(panels.map((panel) => panel.plate)).toEqual(["AA", "BB"])
  })

  it("sin datos no hay paneles", () => {
    expect(buildEvolutionPanels([])).toMatchObject({ panels: [], periods: [], hiddenCount: 0, totalEquipment: 0 })
  })

  it("un equipo sin litros en ningún período no merece un panel vacío", () => {
    expect(buildEvolutionPanels([point("AA-1", "2026-07-01", 0)]).panels).toEqual([])
  })
})

describe("describeEvolution", () => {
  it("dice qué equipo consume más, cuántos litros y qué parte de los que se muestran", () => {
    const text = describeEvolution(buildEvolutionPanels([
      point("AA-1", "2026-07-01", 600), point("AA-1", "2026-08-01", 600), point("BB-2", "2026-07-01", 400), point("BB-2", "2026-08-01", 400),
    ]))

    expect(text).toContain("AA-1")
    expect(text).toContain("1.200 L")
    expect(text).toContain("60 % del total")
    expect(text).toContain("2 equipos")
    expect(text).not.toContain("de todos")
  })

  it("si hay equipos que no caben dice cuánto del total cubren los paneles, y el porcentaje del primero es del total de todos", () => {
    const many = Array.from({ length: 5 }, (_, index) => [point(`EQ-${index}`, "2026-07-01", 100), point(`EQ-${index}`, "2026-08-01", 100)]).flat()
    const text = describeEvolution(buildEvolutionPanels(many, 2))

    expect(text).toContain("Los 2 equipos que más consumen")
    expect(text).toContain("de 5")
    // Dos de cinco equipos iguales: los paneles cubren 40 % y el mayor tiene 20 % de lo cargado por todos, no 50 % de lo que se ve.
    expect(text).toContain("40 % de los litros de todos")
    expect(text).toContain("20 % del total")
  })

  it("con un solo período dice que no hay evolución que mirar", () => {
    const text = describeEvolution(buildEvolutionPanels([point("AA-1", "2026-07-01", 600), point("BB-2", "2026-07-01", 400)]))

    expect(text).toMatch(/un solo período/i)
    expect(text).not.toContain("%")
  })

  it("sin paneles no hay frase", () => {
    expect(describeEvolution(buildEvolutionPanels([]))).toBeNull()
  })
})

describe("evolutionTable", () => {
  it("«Ver datos»: equipo, período y litros, con el hueco dicho en palabras", () => {
    const { headers, rows } = evolutionTable(buildEvolutionPanels([
      point("AA-1", "2026-07-01", 100), point("AA-1", "2026-09-01", 300), point("BB-2", "2026-08-01", 5),
    ]))

    expect(headers).toEqual(["Equipo", "Período", "Litros"])
    expect(rows).toContainEqual(["AA-1", "01-07-2026", "100"])
    expect(rows).toContainEqual(["AA-1", "01-08-2026", "Sin registro"])
    expect(rows).toContainEqual(["BB-2", "01-09-2026", "Sin registro"])
  })
})
