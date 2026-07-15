"use client"

import { ChartLineUp } from "@phosphor-icons/react"
import type { HeatmapCell } from "@/lib/combustibles/consumption-dashboard"

const HIGH_COLOR = "var(--color-danger)"
const MID_COLOR = "var(--color-warning-ink)"
const LOW_COLOR = "var(--color-success)"
const EMPTY_COLOR = "var(--color-surface-2)"

function EmptyHeatmap() {
  return (
    <div className="flex h-64 flex-col items-center justify-center border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-6 text-center">
      <ChartLineUp size={24} className="mb-2 text-[var(--color-text-subtle)]" aria-hidden />
      <p className="max-w-64 text-sm leading-5 text-[var(--color-text-muted)]">Sin datos para construir la matriz faena × equipo.</p>
    </div>
  )
}

function heatColor(intensity: number): string {
  if (intensity >= 0.7) return HIGH_COLOR
  if (intensity >= 0.35) return MID_COLOR
  if (intensity > 0) return LOW_COLOR
  return EMPTY_COLOR
}

/** Mapa de calor faena × equipo con CSS grid. Cada celda muestra litros y se
 *  colorea por intensidad relativa. */
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
    <div className="overflow-x-auto" aria-label="Matriz faena × equipo">
      <div className="min-w-[800px]">
        <div className="grid" style={{ gridTemplateColumns: `140px repeat(${topEquipments.length}, minmax(80px, 1fr))` }}>
          {/* Header row */}
          <div className="p-2 text-xs font-medium text-(--color-text-muted)" />
          {topEquipments.map((eq) => (
            <div key={eq} className="p-2 text-center text-[10px] font-medium text-(--color-text-muted) truncate leading-tight" title={eq}>{eq}</div>
          ))}

          {/* Data rows */}
          {topWorksites.map((ws) => (
            <>
              <div key={`label-${ws}`} className="flex items-center p-2 text-xs font-medium text-(--color-text) truncate" title={ws}>{ws}</div>
              {topEquipments.map((eq) => {
                const cell = cellMap.get(`${ws}::${eq}`)
                if (!cell) return <div key={`${ws}::${eq}`} className="flex items-center justify-center border border-(--color-border) bg-(--color-surface-2) p-2 text-[10px] text-(--color-text-muted)">—</div>
                return (
                  <div
                    key={`${ws}::${eq}`}
                    className="flex flex-col items-center justify-center border border-(--color-border) p-2 text-center text-[10px] leading-tight"
                    style={{ backgroundColor: heatColor(cell.intensity), color: cell.intensity >= 0.35 ? "white" : "var(--color-text)" }}
                    title={`${cell.worksiteName} · ${cell.equipmentLabel}: ${cell.liters.toLocaleString("es-CL")} L / ${cell.amount.toLocaleString("es-CL")} CLP`}
                  >
                    <span className="font-mono font-semibold">{cell.liters >= 1000 ? `${(cell.liters / 1000).toFixed(0)}k` : Math.round(cell.liters)}</span>
                    <span className="opacity-75">L</span>
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10px] text-(--color-text-muted)">
        <span>Menos</span>
        <span className="inline-block h-3 w-6 rounded-sm border border-(--color-border)" style={{ backgroundColor: LOW_COLOR }} />
        <span className="inline-block h-3 w-6 rounded-sm border border-(--color-border)" style={{ backgroundColor: MID_COLOR }} />
        <span className="inline-block h-3 w-6 rounded-sm border border-(--color-border)" style={{ backgroundColor: HIGH_COLOR }} />
        <span>Más litros</span>
        <span className="ml-3">—{">"} Hover para detalle</span>
      </div>
    </div>
  )
}
