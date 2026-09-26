import { describe, expect, it } from "vitest"
import { effectiveApprovedExecutionsByCell, pdtpCountedExecuted } from "./compliance"

type Row = Parameters<typeof effectiveApprovedExecutionsByCell>[0][number]
// `sourceType` no interviene en la regla: se deja en los casos sólo para
// leerlos como el hecho que representan.
const base = { activityId: "act-1", worksiteId: "ws-1", year: 2026, month: 3, week: 1 } as const
const row = (over: Partial<Row> & { sourceType?: string }): Row => ({ ...base, origin: "manual", executedQuantity: 1, ...over }) as Row

describe("effectiveApprovedExecutionsByCell (PREV-C02)", () => {
  it("la carga manual y la acreditación de otro submódulo en la misma semana cuentan una vez: el mayor", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "manual", executedQuantity: 1 }),
      row({ origin: "integration", sourceType: "capacitacion_ocurrencia", executedQuantity: 1 }),
    ])
    expect(cells).toEqual([{ activityId: "act-1", month: 3, week: 1, executedQuantity: 1 }])
  })

  it("si la carga manual declara más que lo acreditado, cuenta la manual", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "manual", executedQuantity: 3 }),
      row({ origin: "integration", sourceType: "inspeccion", executedQuantity: 1 }),
    ])
    expect(cells[0]!.executedQuantity).toBe(3)
  })

  it("las integraciones entre sí siguen sumando: son hechos distintos", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "integration", sourceType: "inspeccion", executedQuantity: 1 }),
      row({ origin: "integration", sourceType: "inspeccion", executedQuantity: 1 }),
      row({ origin: "integration", sourceType: "evaluacion_sst", executedQuantity: 1 }),
    ])
    expect(cells[0]!.executedQuantity).toBe(3)
  })

  it("una importación XLSX cuenta como carga manual", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "xlsx_import", executedQuantity: 1 }),
      row({ origin: "integration", sourceType: "capacitacion_ocurrencia", executedQuantity: 1 }),
    ])
    expect(cells[0]!.executedQuantity).toBe(1)
  })

  it("la misma semana en dos faenas son dos celdas", () => {
    const cells = effectiveApprovedExecutionsByCell([row({}), row({ worksiteId: "ws-2" })])
    expect(cells).toHaveLength(2)
  })
})

describe("pdtpCountedExecuted (PREV-C02, tope por actividad y mes)", () => {
  it("una actividad aporta como máximo lo planificado", () => {
    expect(pdtpCountedExecuted(1, 3)).toBe(1)
    expect(pdtpCountedExecuted(2, 1)).toBe(1)
  })

  it("sin plan en el mes, lo ejecutado no aporta", () => {
    expect(pdtpCountedExecuted(0, 2)).toBe(0)
  })
})
