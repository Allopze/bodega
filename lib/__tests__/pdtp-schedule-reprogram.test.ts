import { describe, expect, it } from "vitest"
import { classifyScheduleLapse, planScheduleReprogram } from "@/scripts/reprogram-pdtp-2026-schedule"

describe("planScheduleReprogram", () => {
  it("mueve las celdas vencidas a la ventana restante conservando la cantidad total", () => {
    const cells = [
      { month: 1, week: 4, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
    ]
    const result = planScheduleReprogram({ cells, fromMonth: 9 })
    expect(result.every((cell) => cell.month >= 9)).toBe(true)
    expect(result.reduce((sum, cell) => sum + cell.plannedQuantity, 0)).toBe(2)
  })

  it("conserva intactas las celdas que ya caen en la ventana", () => {
    const cells = [
      { month: 3, week: 1, plannedQuantity: 1 },
      { month: 10, week: 2, plannedQuantity: 1 },
    ]
    const result = planScheduleReprogram({ cells, fromMonth: 9 })
    expect(result).toContainEqual({ month: 10, week: 2, plannedQuantity: 1 })
    expect(result).toHaveLength(2)
  })

  it("no crea dos celdas en el mismo mes y semana: suma la cantidad", () => {
    const cells = [
      { month: 1, week: 1, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
      { month: 3, week: 1, plannedQuantity: 1 },
      { month: 4, week: 1, plannedQuantity: 1 },
      { month: 5, week: 1, plannedQuantity: 1 },
    ]
    const result = planScheduleReprogram({ cells, fromMonth: 11 })
    const keys = result.map((cell) => `${cell.month}-${cell.week}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(result.reduce((sum, cell) => sum + cell.plannedQuantity, 0)).toBe(5)
  })

  it("es idempotente: re-planificar lo ya planificado no cambia nada", () => {
    const cells = [{ month: 2, week: 3, plannedQuantity: 2 }]
    const once = planScheduleReprogram({ cells, fromMonth: 9 })
    expect(planScheduleReprogram({ cells: once, fromMonth: 9 })).toEqual(once)
  })
})

describe("classifyScheduleLapse", () => {
  it("clasifica totalmente_vencida cuando todas las celdas caen antes del mes destino", () => {
    const cells = [
      { month: 1, week: 4, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
    ]
    expect(classifyScheduleLapse({ cells, fromMonth: 9 })).toBe("totalmente_vencida")
  })

  it("clasifica parcialmente_vencida cuando ya tenía celdas en la ventana y además celdas para mover", () => {
    const cells = [
      { month: 3, week: 1, plannedQuantity: 1 },
      { month: 10, week: 2, plannedQuantity: 1 },
    ]
    expect(classifyScheduleLapse({ cells, fromMonth: 9 })).toBe("parcialmente_vencida")
  })

  it("clasifica sin_cambios cuando no hay ninguna celda para mover", () => {
    const cells = [{ month: 10, week: 2, plannedQuantity: 1 }]
    expect(classifyScheduleLapse({ cells, fromMonth: 9 })).toBe("sin_cambios")
    expect(classifyScheduleLapse({ cells: [], fromMonth: 9 })).toBe("sin_cambios")
  })
})
