import type * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import type { ConsumptionDashboardData, EquipmentTypeConsumptionRow, HeatmapCell, VehicleEvolutionPoint } from "@/lib/combustibles/consumption-dashboard"
import { buildEvolutionPanels, describeEvolution, evolutionTable } from "@/lib/combustibles/evolution-panels"
import type { ScatterPoint } from "@/lib/combustibles/operations-dashboard"
import { ConsumptionAnalysisMetrics } from "../../consumption-kpis"
import { Disclosure } from "../_components/disclosure"
import { EvolutionChart, PatenteRankingChart, PriceEvolutionChart, RendimientoChart } from "../../consumption-charts-lazy"
import { CategoryBarChart } from "../../fuel-charts-lazy"
import { LitersVsHourMeterChart, LitersVsKmChart, EvolutionByVehicleChart } from "../../operations-charts-lazy"
import { WorksiteEquipmentHeatmap } from "../../worksite-equipment-heatmap"

export interface CardsAnalysisProps {
  dashboard: ConsumptionDashboardData | null
  byEquipmentType: EquipmentTypeConsumptionRow[]
  scatter: ScatterPoint[]
  evolution: VehicleEvolutionPoint[]
  heatmap: HeatmapCell[]
  canViewCosts: boolean
  /** Acción de los vacíos de los gráficos (agregar el reporte de tarjeta), si la persona puede. */
  emptyAction?: { label: string; href: string }
  /** Etiqueta del período, para el gráfico de tendencia. */
  periodLabel: string
  /** Qué meses cubre la evolución por equipo («Últimos 6 meses, hasta octubre de 2026.»): es una ventana, no el período. */
  evolutionCaption?: string
  /** «Exportar Excel» de la tabla de evolución por equipo; sólo si la persona puede exportar combustible. */
  excel?: ChartDataExcel
}

function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="mb-8 last:mb-0">
      <h3 id={`${id}-title`} className="text-h3 text-[var(--color-text)]">{title}</h3>
      {hint ? <p className="mb-3 mt-0.5 max-w-[78ch] text-sm text-[var(--color-text-muted)]">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  )
}

/**
 * Un análisis de apoyo, plegado: el pliegue «Más análisis de tarjetas» no puede
 * abrirse con una docena de gráficos a la vez. A la vista quedan los tres que
 * responden lo principal (tendencia, precio y litros por tipo de equipo) y el
 * resto se abre a demanda. `Disclosure` monta su contenido sólo al abrirse, así
 * que un gráfico plegado ni siquiera se dibuja.
 */
function FoldBlock({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={title} className="mb-3 last:mb-0">
      <Disclosure title={title} description={hint}>{children}</Disclosure>
    </section>
  )
}

/**
 * «Más análisis de tarjetas»: todo lo que traía la vista «Consumo por tarjeta»
 * de antes, sin perder un gráfico. Tendencia y precio y litros por tipo de
 * equipo quedan a la vista (a lo más tres gráficos); litros contra odómetro y
 * horómetro, evolución por equipo, la matriz faena × equipo en un solo tono y
 * los rankings por patente (un clic abre la ficha del equipo) van plegados. Los
 * datos llegan ya filtrados por fuente, patente y vínculo con un equipo.
 */
export function CardsAnalysis({ dashboard, byEquipmentType, scatter, evolution, heatmap, canViewCosts, emptyAction, periodLabel, evolutionCaption, excel }: CardsAnalysisProps) {
  const scatterKm = scatter.filter((point) => point.medidoPor === "km")
  const scatterHora = scatter.filter((point) => point.medidoPor === "hora")
  const hasAnything = byEquipmentType.length > 0 || scatterKm.length > 0 || scatterHora.length > 0 || evolution.length > 0 || heatmap.length > 0
    || (dashboard?.seriesPorPeriodo.length ?? 0) > 0

  const evolutionView = buildEvolutionPanels(evolution)
  const evolutionSummary = describeEvolution(evolutionView)

  if (!hasAnything) {
    return (
      <EmptyState
        compact
        title="Sin datos de tarjetas en el período"
        description="Amplía el período, quita la faena o los filtros, o agrega el reporte de tarjeta para ver tendencias, rendimientos y rankings por patente."
        action={emptyAction ? <Button asChild variant="secondary" size="sm"><Link href={emptyAction.href}>{emptyAction.label}</Link></Button> : undefined}
      />
    )
  }

  return (
    <div>
      {dashboard ? <ConsumptionAnalysisMetrics kpis={dashboard.kpis} canViewCosts={canViewCosts} /> : null}

      {dashboard ? (
        <Block id="tendencia" title={canViewCosts ? "Tendencia y precio" : "Tendencia de consumo"} hint={`${canViewCosts ? "Litros y gasto por período; el precio por litro aparte, para no confundirlo con el volumen." : "Litros por período."} ${periodLabel}.`}>
          <div className={canViewCosts ? "grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,0.9fr)]" : "grid gap-6"}>
            <ChartErrorBoundary chartName="Evolución mensual">
              <EvolutionChart data={dashboard.seriesPorPeriodo} showCosts={canViewCosts} emptyAction={emptyAction} />
            </ChartErrorBoundary>
            {canViewCosts ? <PriceEvolutionChart data={dashboard.seriesPorPeriodo} emptyAction={emptyAction} /> : null}
          </div>
        </Block>
      ) : null}

      {byEquipmentType.length > 0 ? (
        <Block id="por-tipo" title="Litros por tipo de equipo" hint="¿Qué tipo de equipo consume la mayor parte del combustible?">
          <ChartErrorBoundary chartName="Consumo por tipo de equipo">
            <CategoryBarChart
              data={byEquipmentType.map((row) => ({ group: row.equipmentTypeName, totalLiters: row.totalLiters, totalAmount: row.totalAmount ?? 0, count: row.uniqueVehicles }))}
              title="Tipo de equipo"
              metric="liters"
            />
          </ChartErrorBoundary>
        </Block>
      ) : null}

      {scatterKm.length > 0 || scatterHora.length > 0 ? (
        <FoldBlock id="dispersion" title="Litros contra odómetro y horómetro" hint="Cada punto es una carga de la planilla con lectura de medidor y litros mayores a cero.">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Litros contra kilometraje <span className="font-normal text-[var(--color-text-muted)]">· {scatterKm.length} cargas con odómetro</span></h4>
              <ChartErrorBoundary chartName="Litros vs kilometraje"><LitersVsKmChart points={scatterKm} /></ChartErrorBoundary>
            </div>
            <div>
              <h4 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Litros contra horómetro <span className="font-normal text-[var(--color-text-muted)]">· {scatterHora.length} cargas con horómetro</span></h4>
              <ChartErrorBoundary chartName="Litros vs horómetro"><LitersVsHourMeterChart points={scatterHora} /></ChartErrorBoundary>
            </div>
          </div>
        </FoldBlock>
      ) : null}

      {evolution.length > 0 ? (
        <FoldBlock id="evolucion-equipo" title="Evolución por equipo" hint={[evolutionCaption, evolutionSummary, "Un panel por equipo, todos con la misma escala; se muestran hasta 8."].filter(Boolean).join(" ")}>
          <ChartErrorBoundary chartName="Evolución por equipo"><EvolutionByVehicleChart view={evolutionView} /></ChartErrorBoundary>
          {evolutionView.panels.length > 0 ? <ChartDataTable caption="Litros por equipo y período" {...evolutionTable(evolutionView)} excel={excel} /> : null}
        </FoldBlock>
      ) : null}

      {heatmap.length > 0 ? (
        <FoldBlock id="matriz" title="¿Dónde y qué equipo consume más?" hint="Litros por faena y equipo, las 12 faenas y los 12 equipos con más litros. Más oscuro es más litros.">
          <WorksiteEquipmentHeatmap cells={heatmap} />
        </FoldBlock>
      ) : null}

      {dashboard ? (
        <FoldBlock id="rankings" title="Patentes bajo observación" hint="Selecciona una barra para abrir la ficha del equipo (si la patente no es un equipo de la flota, filtra sus tarjetas).">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Mayor consumo</h4>
              <PatenteRankingChart data={dashboard.topPatentesPorConsumo} metric="cantidad" />
            </div>
            {canViewCosts ? (
              <div>
                <h4 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Mayor gasto</h4>
                <PatenteRankingChart data={dashboard.topPatentesPorGasto} metric="monto" />
              </div>
            ) : null}
            <div>
              <h4 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Más transacciones</h4>
              <PatenteRankingChart data={dashboard.transaccionesPorPatente} metric="transacciones" />
            </div>
            <div>
              <h4 className="mb-1 text-sm font-semibold text-[var(--color-text)]">Rendimiento por patente</h4>
              <p className="mb-1 text-xs text-[var(--color-text-muted)]">Las barras ámbar piden revisar la operación o el dato de origen.</p>
              <ChartErrorBoundary chartName="Rendimiento por patente"><RendimientoChart data={dashboard.rendimientoPorPatente} /></ChartErrorBoundary>
            </div>
          </div>
        </FoldBlock>
      ) : null}
    </div>
  )
}
