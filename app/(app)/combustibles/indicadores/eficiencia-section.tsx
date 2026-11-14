import type { Session } from "next-auth"
import Link from "next/link"
import { Info } from "@phosphor-icons/react/dist/ssr"
import { CoverageNotice } from "@/components/charts/coverage-notice"
import { Button } from "@/components/ui/button"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { can } from "@/lib/auth/can"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { getIdleFleetMonths } from "@/lib/combustibles/control/queries/idle"
import { getMeterRateSeries } from "@/lib/combustibles/control/queries/meter-rates"
import { controlFiltersFromPeriod } from "@/lib/combustibles/control/queries/period-filters"
import { coverageNoticeText, fuelSourcesHref } from "@/lib/combustibles/coverage-notice"
import { getFuelProviderCoverageGaps } from "@/lib/combustibles/coverage-notice-data"
import { idleTable, idleWindowTotals, indicatorWindows, windowCaption } from "@/lib/combustibles/indicators/view"
import { describeMeterRate, type MeterRateSeries } from "@/lib/combustibles/meter-rate-series"
import { meterRateNotes, meterRateTable } from "@/lib/combustibles/meter-rate-view"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { formatQty } from "@/lib/utils"
import { monthText } from "../consumo/_components/format"
import { hrefInContext } from "../consumo/_components/page-links"
import { createSourceTracker } from "../consumo/_components/track-sources"
import { BlockError, ChartBlock, type BlockHeadline } from "./indicator-blocks"
import { IdleLitersChart, MeterRateChart } from "./indicators-charts-lazy"

const RATE_BLOCKS: Record<PerformanceUnit, { title: string; source: string }> = {
  km_per_liter: { title: "Equipos con odómetro · km/L por mes", source: "lecturas de odómetro de las cargas con tarjeta Copec" },
  liters_per_hour: { title: "Equipos con horómetro · L/h por mes", source: "lecturas de horómetro de las cargas con tarjeta Copec" },
}

function rateHeadline(series: MeterRateSeries): BlockHeadline {
  const unit = PERFORMANCE_UNIT_LABELS[series.unit]
  if (series.rate === null) return { value: "—", caption: "datos insuficientes para calcular el rendimiento de la ventana" }
  return {
    value: `${formatQty(series.rate, undefined, { maximumFractionDigits: 2 })} ${unit}`,
    caption: `rendimiento en conjunto de la ventana (${series.unit === "km_per_liter" ? "más es mejor" : "menos es mejor"})`,
  }
}

/**
 * «Eficiencia»: cómo rinden los equipos mes a mes (km/L con odómetro, L/h con horómetro,
 * nunca en el mismo eje) y cuánto combustible se va con el motor en vacío. Reutiliza lo
 * de Consumo: el rendimiento por mes sale de las lecturas de medidor de Copec
 * (`getMeterRateSeries`) y el ralentí de la telemetría diaria (`getIdleFleetMonths`).
 * No lleva tiles: la cifra de rendimiento del período ya está en «Consumo» (A5).
 */
export async function EficienciaSection({ session, period, worksiteId }: { session: Session; period: ResolvedFuelPeriod; worksiteId?: string }) {
  const windows = indicatorWindows(period)
  const filters = controlFiltersFromPeriod(period, worksiteId ? { faena: worksiteId } : {})
  const historyFilters = { ...filters, year: Number(windows.chart.from.slice(0, 4)), months: [] as number[], from: windows.chart.from, to: windows.chart.to }
  const canExport = can(session, "combustibles:export")
  const sourcesHref = fuelSourcesHref(session)
  const withPeriod = (href: string) => hrefInContext(href, period, worksiteId)

  const { track, degraded, total } = createSourceTracker("combustibles/indicadores/eficiencia")
  const [rates, idle, coverage] = await Promise.all([
    track(getMeterRateSeries(session, filters, { from: windows.chart.from, to: windows.chart.to, monthKeys: windows.chart.monthKeys }), null, "rendimiento por mes"),
    track(getIdleFleetMonths(session, historyFilters), null, "motor en vacío por mes"),
    track(getFuelProviderCoverageGaps(session, windows.chart.monthKeys, { worksiteId }), { gapMonths: [], partialMonths: [] }, "cobertura del proveedor"),
  ])

  const caption = windowCaption(windows.chart, period)
  const rateUnits = (["km_per_liter", "liters_per_hour"] as const).filter((unit) => rates.data?.[unit].status !== "empty")
  const idleRows = (idle.data ?? []).filter((row) => row.litersIdle !== null)
  const idleTotals = idleWindowTotals(idle.data ?? [])

  // Un mes sin lecturas de medidor también es un hueco del rendimiento (su prueba es más estricta que la del libro).
  const coverageInput = {
    gapMonths: [
      ...coverage.data.gapMonths,
      ...(rates.data ? Object.values(rates.data).flatMap((series) => series.months.filter((month) => month.status === "gap").map((month) => month.month)) : []),
    ],
    partialMonths: coverage.data.partialMonths,
    subject: "el rendimiento informado por Copec",
  }
  const coverageNote = coverageNoticeText(coverageInput)
  const excel = canExport ? { permission: "combustibles:export" as const, notes: coverageNote ? [coverageNote] : [] } : undefined

  const links = [
    { label: "Rendimiento", href: withPeriod("/combustibles/consumo/rendimiento/camiones") },
    { label: "Motor en vacío", href: withPeriod(FUEL_PATHS.consumoMotorVacio) },
  ]

  const nothing = !degraded.length && rateUnits.length === 0 && idleRows.length === 0
  if (nothing) {
    return (
      <DashboardSection
        id="eficiencia"
        title="Eficiencia"
        links={links}
        charts={
          <ChartSlot span="full">
            <EmptyState
              compact
              as="p"
              title="Todavía no hay lecturas de medidor ni telemetría para mostrar"
              description="El rendimiento sale de la lectura del odómetro y del horómetro de las cargas con tarjeta Copec, y el motor en vacío de la telemetría de los equipos (VisionLink). Aparecen cuando esas fuentes traen datos de la ventana."
              action={sourcesHref ? <Button asChild><Link href={withPeriod(sourcesHref)}>Ir a Fuentes de datos</Link></Button> : undefined}
            />
          </ChartSlot>
        }
      />
    )
  }

  return (
    <>
      <DegradedDataBanner degraded={degraded} total={total()} />
      <DashboardSection
        id="eficiencia"
        title="Eficiencia"
        links={links}
        coverage={coverageNote || idleRows.length > 0 ? (
          <div className="grid gap-1.5">
            <CoverageNotice {...coverageInput} sourcesHref={sourcesHref ? withPeriod(sourcesHref) : undefined} />
            {idleRows.length > 0 ? (
              <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-muted)]">
                <Info size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0" />
                <span>El motor en vacío sólo cuenta los equipos con telemetría VisionLink.</span>
              </p>
            ) : null}
          </div>
        ) : undefined}
        charts={
          <>
            {rates.failed ? <BlockError what="el rendimiento por mes" span="wide" /> : rates.data ? rateUnits.map((unit) => {
              const series = rates.data![unit]
              const block = RATE_BLOCKS[unit]
              const table = meterRateTable(series)
              return (
                <ChartBlock
                  key={unit}
                  title={block.title}
                  description={`${caption} · ${block.source}`}
                  headline={rateHeadline(series)}
                  table={{ caption: `Rendimiento mensual en ${PERFORMANCE_UNIT_LABELS[unit]}`, ...table, excel }}
                >
                  <MeterRateChart series={series} />
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">{describeMeterRate(series)}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{meterRateNotes(series)[0]}</p>
                </ChartBlock>
              )
            }) : null}
            {idle.failed ? <BlockError what="los litros en vacío" span="fillXl" /> : idleRows.length > 0 ? (
              <ChartBlock
                span="fillXl"
                title="Litros consumidos en vacío por mes"
                description={`${caption} · telemetría VisionLink, sólo equipos que la informan`}
                headline={idleTotals ? {
                  value: `${formatQty(idleTotals.litersIdle, undefined, { maximumFractionDigits: 0 })} L`,
                  caption: idleTotals.pct === null ? "con el motor en vacío en la ventana" : `con el motor en vacío en la ventana, el ${formatQty(idleTotals.pct, undefined, { maximumFractionDigits: 1 })} % de los litros informados`,
                } : undefined}
                table={{
                  caption: "Litros en vacío por mes",
                  ...idleTable(idleRows.map((row) => ({ label: monthText(row.month), month: row.month, litersIdle: row.litersIdle, idleLitersPct: row.idleLitersPct }))),
                  excel,
                }}
              >
                <IdleLitersChart data={idleRows.map((row) => ({ label: monthText(row.month), litersIdle: row.litersIdle, idleLitersPct: row.idleLitersPct }))} />
              </ChartBlock>
            ) : null}
          </>
        }
      />
    </>
  )
}
