import { describe, expect, it } from "vitest"
import { MIN_IDLE_DAY_HOURS, describeIdleDaily, idleDailyChartData, idleDailyTable, type IdleDay } from "./idle-daily"

/**
 * CHART-024: el motor en vacío de un equipo, día a día. Un día de minutos con el motor andando daría 100 % sin significar
 * nada (la pantalla de vacío ya lo advierte y sus «días con más vacío» exigen 1 h): esos días no dibujan porcentaje.
 */

const day = (date: string, operatingHours: number, idleHours: number): IdleDay => ({
  day: date, operatingHours, idleHours, idlePct: operatingHours > 0 ? (idleHours / operatingHours) * 100 : null,
})

describe("idleDailyChartData", () => {
  it("rotula el día como dd/mm y conserva las horas de motor", () => {
    expect(idleDailyChartData([day("2026-03-02", 10, 2)])).toEqual([{ label: "02/03", operatingHours: 10, idlePct: 20 }])
  })

  it("un día con menos de 1 hora de motor no dibuja porcentaje: queda un hueco, no un 100 %", () => {
    const data = idleDailyChartData([day("2026-03-02", 10, 2), day("2026-03-03", 0.5, 0.5), day("2026-03-04", 1, 1)])

    expect(MIN_IDLE_DAY_HOURS).toBe(1)
    expect(data.map((point) => point.idlePct)).toEqual([20, null, 100])
    // Las horas de motor del día corto sí se ven: la barra existe, lo engañoso es el porcentaje.
    expect(data[1]!.operatingHours).toBe(0.5)
  })

  it("un día sin horas de motor no tiene porcentaje", () => {
    expect(idleDailyChartData([day("2026-03-05", 0, 0)])[0]!.idlePct).toBeNull()
  })
})

describe("describeIdleDaily", () => {
  it("dice el día con más tiempo en vacío (entre los de al menos 1 h) y con cuántas horas de motor", () => {
    const text = describeIdleDaily([day("2026-03-02", 10, 2), day("2026-03-03", 8, 4), day("2026-03-04", 0.5, 0.5)])

    expect(text).toContain("03-03-2026")
    expect(text).toContain("50 %")
    expect(text).toContain("8 h de motor")
  })

  it("los días de menos de 1 h no pueden ser «el peor»: su 100 % no significa nada", () => {
    const text = describeIdleDaily([day("2026-03-02", 10, 2), day("2026-03-04", 0.5, 0.5)])

    expect(text).toContain("02-03-2026")
    expect(text).toContain("20 %")
    expect(text).toContain("1 día tuvo menos de 1 h de motor")
  })

  it("el empate se resuelve por más horas de motor y, después, por el día más antiguo", () => {
    expect(describeIdleDaily([day("2026-03-02", 4, 2), day("2026-03-03", 8, 4)])).toContain("03-03-2026")
    expect(describeIdleDaily([day("2026-03-02", 8, 4), day("2026-03-03", 8, 4)])).toContain("02-03-2026")
  })

  it("si ningún día llega a 1 hora de motor lo dice, sin inventar un peor día", () => {
    const text = describeIdleDaily([day("2026-03-02", 0.4, 0.2), day("2026-03-03", 0.9, 0.9)])

    expect(text).toContain("Ningún día del período tuvo al menos 1 hora de motor")
    expect(text).not.toContain("%")
  })

  it("sin días no hay frase", () => {
    expect(describeIdleDaily([])).toBeNull()
  })
})

describe("idleDailyTable", () => {
  it("«Ver datos» trae las horas de cada día y el % sólo donde el gráfico lo dibuja", () => {
    const { headers, rows } = idleDailyTable([day("2026-03-02", 10, 2), day("2026-03-04", 0.5, 0.5), day("2026-03-05", 0, 0)])

    expect(headers).toEqual(["Día", "Horas de motor", "Horas en vacío", "% en vacío"])
    expect(rows).toEqual([
      ["02-03-2026", "10", "2", "20 %"],
      ["04-03-2026", "0,5", "0,5", "—"],
      ["05-03-2026", "0", "0", "—"],
    ])
  })
})
