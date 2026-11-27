import { BulletBar } from "@/components/charts/bullet-bar"
import { NEXT_THRESHOLD } from "@/lib/mantencion/status"
import type { MantUnit } from "@/lib/mantencion/types"
import { equipmentAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import { estimateLine, remainingText, remainingTone, type PlanningTone } from "@/lib/services/mantencion/looker/planning-rules"
import type { PlanningRow } from "@/lib/services/mantencion/looker/types"
import { cn } from "@/lib/utils"
import { FilterToggle } from "./filter-toggle"

const BULLET_TONE = { ok: "ok", warn: "warning", danger: "danger", muted: "neutral" } as const satisfies Record<PlanningTone, string>

/** Equipos que el gráfico puede dibujar: los que tienen próxima mantención y un intervalo contra el cual medirla. */
export function remainingBarRows(rows: readonly PlanningRow[]): PlanningRow[] {
  return rows.filter((row) => row.remaining != null && row.base != null && row.base > 0)
}

/**
 * «Faltantes para la próxima mantención»: una fila por equipo, de lo más vencido a lo más lejano (las filas ya llegan
 * ordenadas por lo que falta). La barra es la parte del intervalo ya recorrida (`(base − faltan) ÷ base`, llena si
 * está vencida) con una marca en el umbral de «próxima» (85 %); el texto dice siempre cuánto falta o cuánto lleva
 * vencida y, debajo, la fecha estimada. Cada fila es un `FilterToggle` (`x_equipo`): el teclado filtra igual que el
 * mouse, y el gráfico ignora ese filtro para seguir completo.
 */
export function RemainingBars({
  rows,
  unit,
  selectedId,
  emptyMessage,
}: {
  rows: readonly PlanningRow[]
  unit: MantUnit
  selectedId: string | null
  emptyMessage: string
}) {
  const shown = remainingBarRows(rows)
  if (shown.length === 0) {
    return <p className="px-1 py-3 text-sm text-[var(--color-text-muted)]">{emptyMessage}</p>
  }
  return (
    <div role="group" aria-label="Faltantes para la próxima mantención por equipo" className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto pr-1">
      {shown.map((row) => {
        const base = row.base!
        const remaining = row.remaining!
        const tone = remainingTone(row)
        const text = remainingText(remaining, unit)!
        const estimate = estimateLine(row)
        const name = row.plate || row.code
        const active = selectedId === row.vehicleId
        return (
          <FilterToggle
            key={row.vehicleId}
            action={equipmentAction(row.vehicleId, active)}
            aria-label={`${name}: ${text}. ${estimate.title ? "Sin fecha estimada" : `Fecha estimada ${estimate.text}`}`}
            title={`${row.label}${row.worksiteName ? ` · ${row.worksiteName}` : ""}`}
            className={cn("min-h-11 w-full flex-col items-stretch gap-0 px-1 py-1.5 sm:min-h-8", selectedId && !active && "opacity-40")}
          >
            <BulletBar
              compact
              label={name}
              value={base - remaining}
              max={base}
              valueText={text}
              tone={BULLET_TONE[tone]}
              markers={[{ value: base * (1 - NEXT_THRESHOLD), label: `${Math.round((1 - NEXT_THRESHOLD) * 100)} % del intervalo` }]}
              note={estimate.text}
              noteTitle={estimate.title}
            />
          </FilterToggle>
        )
      })}
    </div>
  )
}
