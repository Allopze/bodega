import { ExportButton } from "@/components/ui/export-button"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { Crosstab } from "@/lib/combustibles/control/view-helpers"
import { OverviewRankingChart } from "../_components/charts/overview-charts-lazy"
import { OverviewCrosstab } from "../_components/charts/overview-crosstab"
import { SectionError } from "../_components/charts/overview-section"
import { exportCrosstabAction } from "./export-actions"

const RANKING_LIMIT = 12

const BLOCKS: Array<{ unit: PerformanceUnit; id: string; title: string }> = [
  { unit: "km_per_liter", id: "faenas-km", title: "Faenas con equipos de odómetro" },
  { unit: "liters_per_hour", id: "faenas-horas", title: "Faenas con equipos de horómetro" },
]

/**
 * «Faena × medio de suministro»: los litros de cada faena según de dónde
 * llegó el combustible (tarjeta, surtidor, estanque…), separados en equipos que
 * miden km/L y equipos que miden L/h —no se mezclan—, con el ranking de las
 * faenas con más litros, totales por fila y por columna, y Excel.
 */
export function WorksiteMedium({
  crosstabs,
  exportParams,
  canExport,
}: {
  crosstabs: Record<PerformanceUnit, Crosstab | null>
  exportParams: Record<string, string>
  canExport: boolean
}) {
  return (
    <div className="grid gap-10">
      {BLOCKS.map(({ unit, id, title }) => {
        const crosstab = crosstabs[unit]
        const unitLabel = PERFORMANCE_UNIT_LABELS[unit]
        return (
          <section key={id} aria-labelledby={`${id}-title`}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h3 id={`${id}-title`} className="text-h3 text-[var(--color-text)]">{title} ({unitLabel})</h3>
                <p className="mt-0.5 max-w-[68ch] text-sm text-[var(--color-text-muted)]">¿Qué faenas consumen más y por qué medio? Litros de equipos que miden su rendimiento en {unitLabel}.</p>
              </div>
              {canExport && crosstab ? <ExportButton action={exportCrosstabAction} filters={{ params: exportParams, unit }} label="Exportar Excel" /> : null}
            </div>
            {crosstab ? (
              <div className="grid gap-6">
                <OverviewRankingChart items={crosstab.rows.slice(0, RANKING_LIMIT).map((row) => ({ name: row.worksiteName, liters: row.total }))} unitLabel={unitLabel} />
                {crosstab.rows.length > RANKING_LIMIT ? (
                  <p className="-mt-3 text-xs text-[var(--color-text-muted)]">El gráfico muestra las {RANKING_LIMIT} faenas con más litros; la tabla las trae todas.</p>
                ) : null}
                <OverviewCrosstab
                  crosstab={crosstab}
                  label={`Litros por faena y medio de suministro, equipos en ${unitLabel}`}
                  emptyText={`No hay cargas de equipos en ${unitLabel} con estos filtros. Prueba con un período más largo o sin faena.`}
                />
              </div>
            ) : (
              <SectionError what="los litros por faena y medio" />
            )}
          </section>
        )
      })}
    </div>
  )
}
