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

/*
 * PREV-I08-a, casos residuales (T3). Una ejecución aprobada enlazada a una
 * ocurrencia programada que ya cuenta es el hecho de esa ocurrencia: cuenta
 * una sola vez, con la misma regla en todas las vistas.
 */
describe("effectiveApprovedExecutionsByCell con ocurrencias programadas (PREV-I08-a)", () => {
  const counted = { id: "inst-1", status: "completed", scheduledFor: "2026-03-02", plannedQuantity: 1 }
  const total = (cells: Array<{ executedQuantity: number }>) => cells.reduce((sum, cell) => sum + cell.executedQuantity, 0)

  it("la ejecución enlazada a una ocurrencia contada no suma en su celda", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "integration", sourceType: "inspeccion", executedQuantity: 1, linkedInstance: counted }),
    ])
    expect(total(cells)).toBe(0)
  })

  it("una carga manual en la misma semana que la acreditación enlazada no suma encima de la ocurrencia", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "manual", executedQuantity: 1 }),
      row({ origin: "integration", sourceType: "inspeccion", executedQuantity: 1, linkedInstance: counted }),
    ])
    expect(total(cells)).toBe(0)
  })

  it("lo que la carga manual declara por encima de la acreditación enlazada sigue contando (D2)", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "manual", executedQuantity: 3 }),
      row({ origin: "integration", sourceType: "inspeccion", executedQuantity: 1, linkedInstance: counted }),
    ])
    expect(total(cells)).toBe(2)
  })

  it("una ocurrencia que no cuenta (enviada, no aplica, cancelada) deja la ejecución en el libro", () => {
    for (const status of ["submitted", "not_applicable", "cancelled", "pending"]) {
      const cells = effectiveApprovedExecutionsByCell([
        row({ origin: "integration", executedQuantity: 1, linkedInstance: { ...counted, status } }),
      ])
      expect(total(cells)).toBe(1)
    }
  })

  it("una ocurrencia anterior al corte de exigibilidad no cuenta: la ejecución sigue en el libro", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "integration", executedQuantity: 1, linkedInstance: counted }),
    ], { instanceCutoff: "2026-03-10T00:00:00.000Z" })
    expect(total(cells)).toBe(1)
  })

  it("con `instanceCells` el hecho se mueve a la celda de su ocurrencia, una vez", () => {
    const cells = effectiveApprovedExecutionsByCell([
      row({ origin: "manual", month: 4, week: 1, executedQuantity: 1 }),
      row({ origin: "integration", month: 4, week: 1, executedQuantity: 1, linkedInstance: { ...counted, scheduledFor: "2026-03-20", plannedQuantity: 2 } }),
    ], { instanceCells: true })
    const byCell = Object.fromEntries(cells.map((cell) => [`${cell.month}:${cell.week}`, cell.executedQuantity]))
    // El 20 de marzo cae en la semana 3; la cantidad es la planificada de la ocurrencia.
    expect(byCell["3:3"]).toBe(2)
    expect(byCell["4:1"] ?? 0).toBe(0)
    expect(total(cells)).toBe(2)
  })
})
