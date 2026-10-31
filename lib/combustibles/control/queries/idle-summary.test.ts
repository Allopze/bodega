import { describe, expect, it } from "vitest"
import { summarizeIdleByEquipment } from "./idle-summary"
import type { IdleEquipmentMonthRow } from "./idle"

const row = (overrides: Partial<IdleEquipmentMonthRow>): IdleEquipmentMonthRow => ({
  vehicleId: "v1", equipment: "KA-1 · AA-0001", month: "2026-03", operatingHours: 100, idleHours: 20, workingHours: 80, activeDays: 10,
  idlePct: 20, dailyAvgPct: 19, dailyMaxPct: 40, dailyMinPct: 5, avgWorkingPerDay: 8, avgIdlePerDay: 2, litersWorking: null, litersIdle: null,
  ...overrides,
})

describe("motor en vacío por equipo en todo el período", () => {
  it("suma las horas de los meses y recalcula el % desde las horas, no promedia porcentajes", () => {
    const [summary] = summarizeIdleByEquipment([
      row({ month: "2026-03", operatingHours: 100, idleHours: 20 }),
      row({ month: "2026-04", operatingHours: 300, idleHours: 30 }),
    ])
    expect(summary).toMatchObject({ vehicleId: "v1", operatingHours: 400, idleHours: 50 })
    // 50 ÷ 400 = 12,5 %; el promedio de 20 % y 10 % (15 %) sería falso.
    expect(summary!.idlePct).toBeCloseTo(12.5, 6)
  })

  it("el máximo diario es el mayor de los meses; los litros se suman y quedan nulos si ningún mes los informa", () => {
    const [summary] = summarizeIdleByEquipment([
      row({ month: "2026-03", dailyMaxPct: 40, litersIdle: 10 }),
      row({ month: "2026-04", dailyMaxPct: 55, litersIdle: 5 }),
    ])
    expect(summary).toMatchObject({ dailyMaxPct: 55, litersIdle: 15 })
    const [withoutLiters] = summarizeIdleByEquipment([row({ litersIdle: null }), row({ month: "2026-04", litersIdle: null })])
    expect(withoutLiters!.litersIdle).toBeNull()
  })

  it("un equipo sin horas de funcionamiento no tiene % (no un 0 %)", () => {
    const [summary] = summarizeIdleByEquipment([row({ operatingHours: 0, idleHours: 0, dailyMaxPct: null })])
    expect(summary).toMatchObject({ idlePct: null, dailyMaxPct: null })
  })

  it("ordena por horas en vacío, el que más pierde primero, y separa equipos", () => {
    const summaries = summarizeIdleByEquipment([
      row({ vehicleId: "v1", equipment: "KA-1", idleHours: 10 }),
      row({ vehicleId: "v2", equipment: "KB-2", idleHours: 90 }),
      row({ vehicleId: "v3", equipment: "KC-3", idleHours: 90 }),
    ])
    expect(summaries.map((item) => item.vehicleId)).toEqual(["v2", "v3", "v1"])
  })

  it("sin filas no hay nada que resumir", () => {
    expect(summarizeIdleByEquipment([])).toEqual([])
  })
})
