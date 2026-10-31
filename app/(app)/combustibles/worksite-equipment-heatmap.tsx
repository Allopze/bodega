import * as React from "react"
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr"
import type { HeatmapCell } from "@/lib/combustibles/consumption-dashboard"

/**
 * Pasos de intensidad del mapa: un solo tono (el verde de la marca) que se
 * oscurece con los litros. El color NO codifica categorías: antes el rojo, el
 * ámbar y el verde sugerían malo, regular y bueno, y consumir mucho no es ni
 * bueno ni malo por sí solo. `mix` es el % de verde sobre el fondo de la celda;
 * sólo el paso más oscuro lleva texto blanco (el resto, texto oscuro: así el
 * contraste cumple en todos los pasos).
 */
export const HEATMAP_STEPS = [
  { min: 0.7, mix: 100, label: "Muchos litros" },
  { min: 0.45, mix: 70, label: "Bastantes litros" },
  { min: 0.2, mix: 42, label: "Algunos litros" },
  { min: 0, mix: 18, label: "Pocos litros" },
] as const

const EMPTY_COLOR = "var(--color-surface-2)"

/** Paso de una celda según su intensidad relativa (0 a 1) entre las visibles. */
export function heatmapStep(intensity: number) {
  return HEATMAP_STEPS.find((step) => intensity >= step.min) ?? HEATMAP_STEPS[HEATMAP_STEPS.length - 1]!
}

function stepColor(mix: number): string {
  return `color-mix(in oklab, var(--color-primary) ${mix}%, var(--color-surface))`
}

function EmptyHeatmap() {
  return (
    <div className="flex h-64 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">Sin datos para construir la matriz faena × equipo.</p>
    </div>
  )
}

/**
 * Mapa de calor faena × equipo con CSS grid. Cada celda muestra los litros y
 * se tiñe en un solo tono según su peso relativo (más oscuro = más litros).
 */
export function WorksiteEquipmentHeatmap({ cells }: { cells: HeatmapCell[] }) {
  if (cells.length === 0) return <EmptyHeatmap />

  const worksites = [...new Set(cells.map((c) => c.worksiteName))]
  const equipments = [...new Set(cells.map((c) => c.equipmentLabel))]
  const maxDisplay = 12

  const topWorksites = worksites.slice(0, maxDisplay)
  const topEquipments = equipments.slice(0, maxDisplay)

  const cellMap = new Map<string, HeatmapCell>()
  for (const c of cells) {
    if (topWorksites.includes(c.worksiteName) && topEquipments.includes(c.equipmentLabel)) {
      cellMap.set(`${c.worksiteName}::${c.equipmentLabel}`, c)
    }
  }

  return (
    <div className="overflow-x-auto" aria-label="Matriz faena × equipo: litros por faena y equipo; más oscuro es más litros">
      <div className="min-w-[800px]">
        <div className="grid" style={{ gridTemplateColumns: `140px repeat(${topEquipments.length}, minmax(80px, 1fr))` }}>
          <div className="p-2 text-xs font-medium text-(--color-text-muted)" />
          {topEquipments.map((eq) => (
            <div key={eq} className="p-2 text-center text-[10px] font-medium text-(--color-text-muted) truncate leading-tight" title={eq}>{eq}</div>
          ))}

          {topWorksites.map((ws) => (
            <React.Fragment key={ws}>
              <div className="flex items-center p-2 text-xs font-medium text-(--color-text) truncate" title={ws}>{ws}</div>
              {topEquipments.map((eq) => {
                const cell = cellMap.get(`${ws}::${eq}`)
                if (!cell) return <div key={`${ws}::${eq}`} className="flex items-center justify-center border border-(--color-border) bg-(--color-surface-2) p-2 text-[10px] text-(--color-text-muted)">—</div>
                const step = heatmapStep(cell.intensity)
                return (
                  <div
                    key={`${ws}::${eq}`}
                    className="flex flex-col items-center justify-center border border-(--color-border) p-2 text-center text-[10px] leading-tight"
                    style={{ backgroundColor: cell.liters > 0 ? stepColor(step.mix) : EMPTY_COLOR, color: step.mix === 100 && cell.liters > 0 ? "var(--color-surface)" : "var(--color-text)" }}
                    title={`${cell.worksiteName} · ${cell.equipmentLabel}: ${cell.liters.toLocaleString("es-CL")} L${cell.amount == null ? "" : ` / ${cell.amount.toLocaleString("es-CL")} CLP`}`}
                  >
                    <span className="font-mono font-semibold">{cell.liters >= 1000 ? `${(cell.liters / 1000).toFixed(0)}k` : Math.round(cell.liters)}</span>
                    <span className="opacity-75">L</span>
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-(--color-text-muted)">
        <span>Menos litros</span>
        {[...HEATMAP_STEPS].reverse().map((step) => (
          <span key={step.mix} className="inline-block h-3 w-6 rounded-sm border border-(--color-border)" style={{ backgroundColor: stepColor(step.mix) }} title={step.label} />
        ))}
        <span>Más litros</span>
        <span className="ml-3">→ Pasa el cursor para ver el detalle</span>
      </div>
    </div>
  )
}
