/**
 * «Ver datos» de la evolución por equipo ofrece Excel sólo cuando la pantalla le pasa el permiso de
 * exportar combustible (`combustibles:export`): quien ve la cifra no recibe por eso la descarga.
 *
 * `CardsAnalysis` es un componente de servidor sin estado: se lo invoca y se recorre el árbol de
 * elementos, sin renderizar (los gráficos de recharts los cubren sus propias pruebas).
 */
import { describe, expect, it } from "vitest"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import type { VehicleEvolutionPoint } from "@/lib/combustibles/consumption-dashboard"
import { CardsAnalysis, type CardsAnalysisProps } from "./cards-analysis"

type El = { type: unknown; props: Record<string, unknown> }

function collectElements(node: unknown, result: El[] = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as El
  result.push(element)
  Object.values(element.props).forEach((value) => collectElements(value, result))
  return result
}

const evolution: VehicleEvolutionPoint[] = [
  { periodo: "2026-09-01", plate: "AA0001", vehicleCode: "KA-1", vehicleId: "v-1", liters: 120, amount: null },
  { periodo: "2026-10-01", plate: "AA0001", vehicleCode: "KA-1", vehicleId: "v-1", liters: 180, amount: null },
]

const props: CardsAnalysisProps = {
  dashboard: null,
  byEquipmentType: [],
  scatter: [],
  evolution,
  heatmap: [],
  canViewCosts: false,
  periodLabel: "Octubre de 2026",
}

const evolutionTable = (extra: Partial<CardsAnalysisProps> = {}) =>
  collectElements(CardsAnalysis({ ...props, ...extra })).find((el) => el.type === ChartDataTable)

describe("CardsAnalysis · «Ver datos» de la evolución por equipo → Excel", () => {
  it("sin permiso de exportar no hay Excel", () => {
    const table = evolutionTable()
    expect(table?.props.caption).toBe("Litros por equipo y período")
    expect(table?.props.excel).toBeUndefined()
  })

  it("con `combustibles:export` la tabla recibe el permiso y la nota de cobertura", () => {
    const excel = { permission: "combustibles:export" as const, notes: ["Sin datos del proveedor en sep-2026."] }
    expect(evolutionTable({ excel })?.props.excel).toEqual(excel)
  })
})
