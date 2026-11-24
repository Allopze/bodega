"use client"

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"
import { agingColor } from "@/components/charts/aging-bar"
import { type ChartDataExcel } from "@/components/charts/chart-data-table"
import { DenseChart } from "@/components/charts/dense-chart"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useChartMotion } from "@/components/ui/chart-interactions"
import { RankedList } from "@/components/ui/ranked-list"
import { CHART_COLORS } from "@/lib/chart-palette"
import { type IndicatorGranularity } from "@/lib/indicators/period"
import { AGE_BUCKETS } from "@/lib/services/mantencion/reporte-equipos-metrics"
import { formatQty } from "@/lib/utils"
import { bucketFullLabel, peakOf, StackedBucketsChart, type BucketPoint } from "./indicators-charts"

/**
 * Gráficos de la sección «Reportes de equipos» del Panel de mantención. Todo recharts vive aquí y se
 * carga diferido (`reporte-equipos-charts-lazy.tsx`). El ranking de horas y el de fallas por sistema
 * son `BarRankingChart` y se arman en la sección.
 */

// ── Reportes recibidos contra esperados, por día ───────────────────────────

export interface ReportsPoint extends BucketPoint {
  expected: number
  received: number
}

const REPORT_SERIES = [
  { key: "expected", label: "Esperados", color: CHART_COLORS.neutral },
  { key: "received", label: "Recibidos", color: CHART_COLORS.brand },
] as const

/**
 * Columnas de reportes esperados y recibidos por día (por mes si el período es largo). Las dos series
 * son conteos de reportes, una sola unidad. El titular no repite el porcentaje de la tira: dice cuándo
 * faltaron más reportes, que es lo que el porcentaje no dice.
 */
export function ReportsPerDayChart({ data, granularity, scopeNote, excel }: {
  data: ReportsPoint[]
  granularity: IndicatorGranularity
  scopeNote: string
  excel?: ChartDataExcel
}) {
  const unit = granularity === "day" ? "día" : "mes"
  return (
    <StackedBucketsChart
      title={`Reportes recibidos por ${unit}`}
      source="reportes de equipos (los cancelados no se esperaban)"
      ariaLabel="Reportes de equipos esperados y recibidos por período"
      series={REPORT_SERIES}
      data={data}
      granularity={granularity}
      scopeNote={scopeNote}
      excel={excel}
      stacked={false}
      headline={(at, all) => {
        if (at) {
          return {
            value: formatQty(at.received),
            caption: `de ${formatQty(at.expected)} reportes esperados llegaron el ${bucketFullLabel(at.key, granularity)}`,
          }
        }
        const peak = peakOf(all, (point) => Math.max(0, point.expected - point.received))
        if (peak.value === 0) return { value: "0", caption: "reportes sin recibir: llegaron todos los esperados" }
        return {
          value: formatQty(peak.value),
          caption: peak.point
            ? `reportes sin recibir el ${bucketFullLabel(peak.point.key, granularity)}, el ${unit} con más faltantes`
            : `reportes sin recibir en cada uno de ${peak.tied} ${granularity === "day" ? "días" : "meses"}, el máximo del período`,
        }
      }}
    />
  )
}

// ── Fallas abiertas por equipo, según antigüedad ───────────────────────────

export interface FailureAgeRow {
  key: string
  /** «KA-12 · AAAA-01»: el rótulo del equipo. */
  label: string
  fresh: number
  week: number
  old: number
  total: number
}

const ROW_HEIGHT = 30
const MAX_LABEL = 22

function truncate(label: string) {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}

/**
 * Barras horizontales apiladas: una por equipo, con sus fallas abiertas partidas en tres tramos de
 * antigüedad (0–3, 4–7 y más de 7 días desde que se detectó). El color es **secuencial** y es el de
 * `AgingBar` (gris → rojo: «más a la derecha, más grave»); la cifra total va escrita al final de cada
 * barra y la tabla «Ver datos» trae los tramos. Una sola unidad: fallas.
 */
export function OpenFailuresAgeChart({ rows, ariaLabel, limit = 8 }: {
  rows: FailureAgeRow[]
  ariaLabel: string
  limit?: number
}) {
  const motion = useChartMotion()
  const shown = rows.slice(0, limit)
  if (shown.length === 0) return null

  const data = shown.map((row) => ({ ...row, short: truncate(row.label) }))
  const longest = Math.max(...data.map((row) => row.short.length))
  const labelWidth = Math.min(160, Math.max(56, Math.round(longest * 6.6) + 12))
  const config = Object.fromEntries(
    AGE_BUCKETS.map((bucket, index) => [bucket.id, { label: bucket.label, color: agingColor(index, AGE_BUCKETS.length) }]),
  ) as ChartConfig
  const lastIndex = AGE_BUCKETS.length - 1

  const ranking = (
    <RankedList
      ariaLabel={ariaLabel}
      format="count"
      unit=" fallas"
      order="input"
      limit={shown.length}
      showShare={false}
      items={shown.map((row) => ({
        key: row.key,
        label: row.label,
        value: row.total,
        detail: row.old > 0 ? `${formatQty(row.old)} con más de 7 días` : undefined,
      }))}
    />
  )

  return (
    <DenseChart fallback={ranking}>
      <ul aria-label="Antigüedad de la falla" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        {AGE_BUCKETS.map((bucket, index) => (
          <li key={bucket.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: agingColor(index, AGE_BUCKETS.length) }} />
            {bucket.label}
          </li>
        ))}
      </ul>
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: Math.max(72, data.length * ROW_HEIGHT + 24) }}
        role="img"
        aria-label={`${ariaLabel}; «Ver datos» trae las cifras exactas`}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="2 5" />
          <XAxis type="number" hide domain={[0, "dataMax"]} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="short"
            tickLine={false}
            axisLine={false}
            width={labelWidth}
            interval={0}
            tick={{ fontSize: 12, fill: "var(--color-text)" }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const row = payload[0]?.payload as FailureAgeRow | undefined
                  return row ? `${row.label} · ${formatQty(row.total)} ${row.total === 1 ? "falla abierta" : "fallas abiertas"}` : ""
                }}
              />
            }
          />
          {AGE_BUCKETS.map((bucket, index) => (
            <Bar
              key={bucket.id}
              dataKey={bucket.id}
              name={bucket.label}
              stackId="age"
              fill={agingColor(index, AGE_BUCKETS.length)}
              barSize={18}
              {...(index === lastIndex ? { radius: [0, 3, 3, 0] as [number, number, number, number] } : {})}
              {...motion}
            >
              {index === lastIndex && (
                <LabelList
                  dataKey="total"
                  // Un `<text>` propio, igual que `BarRankingChart`: el total de la pila, no el del último tramo.
                  content={({ x, y, width, height, value }) => (
                    <text
                      x={Number(x ?? 0) + Number(width ?? 0) + 8}
                      y={Number(y ?? 0) + Number(height ?? 0) / 2}
                      dy={4}
                      fontSize={12}
                      fill="var(--color-text-muted)"
                      className="tabular-nums"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {formatQty(Number(value))}
                    </text>
                  )}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </DenseChart>
  )
}
