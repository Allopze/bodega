"use client"

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import {
  ChartActiveSync,
  ColumnHoverCursor,
  ChartTooltipCard,
  seriesOpacity,
  useActiveIndex,
  useChartMotion,
  useTooltipProps,
} from "@/components/ui/chart-interactions"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import {
  InteractiveLegend,
  SERIES_FADE_CLASS,
  SURFACE,
  activeDotFor,
  dimmedBarShape,
  partialTailLineShape,
  useSeriesFocus,
  type LegendEntry,
} from "@/components/charts/chart-parts"
import { CHART_COLORS } from "@/lib/chart-palette"
import { formatCompactQty, formatPercent, formatQty } from "@/lib/utils"
import { GPS_ALERT_CLASS_LABELS, type CountedGpsAlertClass } from "@/lib/services/fleet-gps-alert-class"

/*
 * Gráficos de los Indicadores GPS. Se cargan siempre por `lazyChart`
 * (`gps-charts-lazy.tsx`): recharts no entra al chunk inicial de la página.
 *
 * Cada gráfico devuelve `null` sin datos (su celda del panel se oculta) y dice su
 * cifra en la cabecera. Una unidad por eje (A5b): km y horas, y viajes y km por
 * viaje, van en ejes distintos.
 */

const num = (value: number, digits = 0) => formatQty(value, undefined, { maximumFractionDigits: digits })
const DOT = { r: 3, fill: SURFACE, strokeWidth: 2 } as const

// ── Km y horas de motor ──────────────────────────────────────────────────────

export interface GpsUsagePoint {
  /** Clave del balde («2026-11-03» o «2026-11»). */
  key: string
  /** Rótulo corto del eje («3 nov»). */
  label: string
  km: number
  hours: number
  /** El balde en curso: se dibuja tenue/punteado para que no se lea como caída. */
  partial?: boolean
}

const usageConfig = {
  km: { label: "Km", color: CHART_COLORS.brand },
  hours: { label: "Horas de motor", color: CHART_COLORS.blue },
} satisfies ChartConfig

export function GpsUsageChart({ data, description }: { data: GpsUsagePoint[]; description: string }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  const totalKm = data.reduce((sum, point) => sum + point.km, 0)
  const totalHours = data.reduce((sum, point) => sum + point.hours, 0)
  const hasKm = totalKm > 0
  const hasHours = totalHours > 0
  if (!hasKm && !hasHours) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const partialFrom = data.findIndex((point) => point.partial === true)
  const headlineKm = at ? at.km : totalKm
  const headlineHours = at ? at.hours : totalHours
  const legend: LegendEntry[] = [
    ...(hasKm ? [{ key: "km", label: "Km", color: CHART_COLORS.brand, swatch: "box" as const, value: at ? num(at.km, 1) : undefined }] : []),
    ...(hasHours ? [{ key: "hours", label: "Horas de motor", color: CHART_COLORS.blue, value: at ? num(at.hours, 1) : undefined }] : []),
  ]

  return (
    <ChartFrame
      title="Km recorridos y horas de motor"
      description={`${description}${partialFrom >= 0 ? " · el último tramo es parcial" : ""}`}
      headline={
        <>
          {hasKm && (
            <>
              <ChartHeadlineValue>{num(headlineKm)}</ChartHeadlineValue>
              <ChartHeadlineCaption>{at ? `km · ${at.label}` : "km en el período"}</ChartHeadlineCaption>
            </>
          )}
          {hasHours && (
            <>
              <span className={`${hasKm ? "ml-3 " : ""}text-[28px] font-semibold leading-none tabular-nums tracking-tight text-[var(--color-text)]`}>{num(headlineHours)}</span>
              <ChartHeadlineCaption>{at ? "horas de motor" : "horas de motor en el período"}</ChartHeadlineCaption>
            </>
          )}
        </>
      }
    >
      <ChartContainer config={usageConfig} className={`h-60 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart accessibilityLayer aria-label="Km recorridos y horas de motor por período" data={data} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" minTickGap={16} />
          <ChartActiveSync labels={data.map((row) => row.label)} onIndex={active.setActiveIndex} />
          {hasKm && <YAxis yAxisId="km" tickLine={false} axisLine={false} tickMargin={8} width={44} fontSize={11} tickFormatter={formatCompactQty} />}
          {hasHours && <YAxis yAxisId="hours" orientation={hasKm ? "right" : "left"} tickLine={false} axisLine={false} tickMargin={4} width={44} fontSize={11} tickFormatter={formatCompactQty} />}
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={<ChartTooltipCard names={{ km: "Km", hours: "Horas de motor" }} />}
          />
          {hasKm && (
            <Bar
              yAxisId="km"
              dataKey="km"
              name="Km"
              fill={CHART_COLORS.brand}
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              shape={dimmedBarShape("km", active.activeIndex, focus.focusedKey, partialFrom)}
              {...motion}
            />
          )}
          {hasHours && (
            <Line
              yAxisId="hours"
              type="monotone"
              dataKey="hours"
              name="Horas de motor"
              stroke={CHART_COLORS.blue}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={seriesOpacity("hours", focus.focusedKey)}
              shape={partialTailLineShape(partialFrom)}
              dot={{ ...DOT, stroke: CHART_COLORS.blue }}
              activeDot={activeDotFor(CHART_COLORS.blue)}
              {...motion}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de km y horas de motor" />
      <ChartDataTable
        caption="Km recorridos y horas de motor por período"
        headers={["Período", "Km", "Horas de motor"]}
        rows={data.map((point) => [point.label, num(point.km, 1), num(point.hours, 1)])}
      />
    </ChartFrame>
  )
}

// ── Horas de trabajo y ralentí (VisionLink) ──────────────────────────────────

export interface GpsIdlePoint {
  key: string
  label: string
  /** `null`: el mes no tiene telemetría (un hueco, no un cero). */
  workingHours: number | null
  idleHours: number | null
}

const idleConfig = {
  workingHours: { label: "Trabajo", color: CHART_COLORS.brand },
  idleHours: { label: "Ralentí", color: CHART_COLORS.amber },
} satisfies ChartConfig

export function GpsIdleChart({ data, description, idlePct }: { data: GpsIdlePoint[]; description: string; idlePct: number | null }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (!data.some((point) => (point.workingHours ?? 0) + (point.idleHours ?? 0) > 0)) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const atPct = at && at.workingHours !== null && at.idleHours !== null && at.workingHours + at.idleHours > 0
    ? (at.idleHours / (at.workingHours + at.idleHours)) * 100
    : null
  const shown = at ? atPct : idlePct
  const legend: LegendEntry[] = [
    { key: "workingHours", label: "Trabajo", color: CHART_COLORS.brand, swatch: "box", value: at ? (at.workingHours == null ? "—" : `${num(at.workingHours, 0)} h`) : undefined },
    { key: "idleHours", label: "Ralentí", color: CHART_COLORS.amber, swatch: "box", value: at ? (at.idleHours == null ? "—" : `${num(at.idleHours, 0)} h`) : undefined },
  ]

  return (
    <ChartFrame
      title="Horas de trabajo y ralentí"
      description={description}
      headline={
        <>
          <ChartHeadlineValue>{shown == null ? "—" : formatPercent(shown, 1)}</ChartHeadlineValue>
          <ChartHeadlineCaption>{at ? `del motor en ralentí · ${at.label}` : "del motor en ralentí en el período"}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={idleConfig} className="h-60 w-full" data-chart-kind="bars">
        <BarChart accessibilityLayer aria-label="Horas de trabajo y de ralentí por mes" data={data} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <ChartActiveSync labels={data.map((row) => row.label)} onIndex={active.setActiveIndex} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} fontSize={11} tickFormatter={formatCompactQty} />
          <ChartTooltip
            {...tooltip}
            filterNull={false}
            cursor={<ColumnHoverCursor />}
            content={<ChartTooltipCard names={{ workingHours: "Trabajo (h)", idleHours: "Ralentí (h)" }} />}
          />
          <Bar
            dataKey="workingHours"
            name="Trabajo"
            stackId="hours"
            fill={CHART_COLORS.brand}
            maxBarSize={44}
            shape={dimmedBarShape("workingHours", active.activeIndex, focus.focusedKey)}
            {...motion}
          />
          <Bar
            dataKey="idleHours"
            name="Ralentí"
            stackId="hours"
            fill={CHART_COLORS.amber}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            shape={dimmedBarShape("idleHours", active.activeIndex, focus.focusedKey)}
            {...motion}
          />
        </BarChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de horas de trabajo y ralentí" />
      <ChartDataTable
        caption="Horas de trabajo y ralentí por mes"
        headers={["Mes", "Trabajo (h)", "Ralentí (h)", "% en ralentí"]}
        rows={data.map((point) => {
          const total = (point.workingHours ?? 0) + (point.idleHours ?? 0)
          return [
            point.label,
            point.workingHours == null ? "—" : num(point.workingHours, 1),
            point.idleHours == null ? "—" : num(point.idleHours, 1),
            point.idleHours != null && total > 0 ? formatPercent((point.idleHours / total) * 100, 1) : "—",
          ]
        })}
      />
    </ChartFrame>
  )
}

// ── Viajes y km por viaje (OnWay) ────────────────────────────────────────────

export interface GpsTripPoint {
  key: string
  label: string
  trips: number
  /** Km promedio por viaje; `null` sin viajes (promediar cero viajes no es 0 km). */
  avgKm: number | null
  partial?: boolean
}

const tripConfig = {
  trips: { label: "Viajes", color: CHART_COLORS.teal },
  avgKm: { label: "Km por viaje", color: CHART_COLORS.slate },
} satisfies ChartConfig

export function GpsTripsChart({ data, description, totalTrips, avgKm }: { data: GpsTripPoint[]; description: string; totalTrips: number; avgKm: number | null }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  if (totalTrips <= 0) return null

  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const partialFrom = data.findIndex((point) => point.partial === true)
  const legend: LegendEntry[] = [
    { key: "trips", label: "Viajes", color: CHART_COLORS.teal, swatch: "box", value: at ? num(at.trips) : undefined },
    { key: "avgKm", label: "Km por viaje", color: CHART_COLORS.slate, value: at ? (at.avgKm == null ? "—" : num(at.avgKm, 1)) : undefined },
  ]

  return (
    <ChartFrame
      title="Viajes"
      description={`${description}${partialFrom >= 0 ? " · el último tramo es parcial" : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{num(at ? at.trips : totalTrips)}</ChartHeadlineValue>
          <ChartHeadlineCaption>
            {at ? `viajes · ${at.label}` : `viajes en el período${avgKm != null ? ` · ${num(avgKm, 1)} km en promedio` : ""}`}
          </ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={tripConfig} className={`h-60 w-full ${SERIES_FADE_CLASS}`} data-chart-kind="bars">
        <ComposedChart accessibilityLayer aria-label="Viajes y km por viaje por período" data={data} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" minTickGap={16} />
          <ChartActiveSync labels={data.map((row) => row.label)} onIndex={active.setActiveIndex} />
          <YAxis yAxisId="trips" allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} width={36} fontSize={11} tickFormatter={formatCompactQty} />
          <YAxis yAxisId="avgKm" orientation="right" tickLine={false} axisLine={false} tickMargin={4} width={40} fontSize={11} tickFormatter={formatCompactQty} />
          <ChartTooltip
            {...tooltip}
            filterNull={false}
            cursor={<ColumnHoverCursor />}
            content={<ChartTooltipCard names={{ trips: "Viajes", avgKm: "Km por viaje" }} />}
          />
          <Bar
            yAxisId="trips"
            dataKey="trips"
            name="Viajes"
            fill={CHART_COLORS.teal}
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            shape={dimmedBarShape("trips", active.activeIndex, focus.focusedKey, partialFrom)}
            {...motion}
          />
          <Line
            yAxisId="avgKm"
            type="monotone"
            dataKey="avgKm"
            name="Km por viaje"
            stroke={CHART_COLORS.slate}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={seriesOpacity("avgKm", focus.focusedKey)}
            shape={partialTailLineShape(partialFrom)}
            connectNulls
            dot={{ ...DOT, stroke: CHART_COLORS.slate }}
            activeDot={activeDotFor(CHART_COLORS.slate)}
            {...motion}
          />
        </ComposedChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Series de viajes y km por viaje" />
      <ChartDataTable
        caption="Viajes y km por viaje por período"
        headers={["Período", "Viajes", "Km por viaje"]}
        rows={data.map((point) => [point.label, num(point.trips), point.avgKm == null ? "—" : num(point.avgKm, 1)])}
      />
    </ChartFrame>
  )
}

// ── Alertas por clase (OnWay) ────────────────────────────────────────────────

export interface GpsAlertPoint {
  key: string
  label: string
  /** Encabezado del tooltip y primera columna de la tabla («Semana del 9 nov»). */
  title: string
  counts: Record<CountedGpsAlertClass, number>
  partial?: boolean
}

/** Un color por clase: lo grave en `danger`, el resto en la paleta categórica. */
const ALERT_COLORS: Record<CountedGpsAlertClass, string> = {
  speeding: CHART_COLORS.danger,
  harsh_driving: CHART_COLORS.blue,
  pothole: CHART_COLORS.teal,
  idle: CHART_COLORS.amber,
  other: CHART_COLORS.neutral,
}
const ALERT_ORDER: CountedGpsAlertClass[] = ["speeding", "harsh_driving", "pothole", "idle", "other"]

export function GpsAlertsChart({ data, description, totals }: { data: GpsAlertPoint[]; description: string; totals: Record<CountedGpsAlertClass, number> }) {
  const motion = useChartMotion()
  const tooltip = useTooltipProps()
  const active = useActiveIndex()
  const focus = useSeriesFocus()

  const classes = ALERT_ORDER.filter((cls) => totals[cls] > 0)
  const total = classes.reduce((sum, cls) => sum + totals[cls], 0)
  if (total <= 0) return null

  const rows = data.map((point) => ({ key: point.key, label: point.label, ...point.counts }))
  const at = active.activeIndex === null ? undefined : data[Math.min(active.activeIndex, data.length - 1)]
  const atTotal = at ? classes.reduce((sum, cls) => sum + at.counts[cls], 0) : null
  const partialFrom = data.findIndex((point) => point.partial === true)
  const config = Object.fromEntries(classes.map((cls) => [cls, { label: GPS_ALERT_CLASS_LABELS[cls], color: ALERT_COLORS[cls] }])) satisfies ChartConfig
  const legend: LegendEntry[] = classes.map((cls) => ({
    key: cls,
    label: GPS_ALERT_CLASS_LABELS[cls],
    color: ALERT_COLORS[cls],
    swatch: "box",
    value: at ? num(at.counts[cls]) : num(totals[cls]),
  }))
  const names = Object.fromEntries(classes.map((cls) => [cls, GPS_ALERT_CLASS_LABELS[cls]]))

  return (
    <ChartFrame
      title="Alertas de conducción"
      description={`${description}${partialFrom >= 0 ? " · el último tramo es parcial" : ""}`}
      headline={
        <>
          <ChartHeadlineValue>{num(atTotal ?? total)}</ChartHeadlineValue>
          <ChartHeadlineCaption>{at ? `alertas · ${at.title}` : "alertas en el período"}</ChartHeadlineCaption>
        </>
      }
    >
      <ChartContainer config={config} className="h-60 w-full" data-chart-kind="bars">
        <BarChart accessibilityLayer aria-label="Alertas de conducción por clase y período" data={rows} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" minTickGap={16} />
          <ChartActiveSync labels={rows.map((row) => row.label)} onIndex={active.setActiveIndex} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} width={36} fontSize={11} tickFormatter={formatCompactQty} />
          <ChartTooltip
            {...tooltip}
            cursor={<ColumnHoverCursor />}
            content={<ChartTooltipCard names={names} labelFormatter={(label) => data.find((point) => point.label === String(label))?.title ?? String(label)} />}
          />
          {classes.map((cls, index) => (
            <Bar
              key={cls}
              dataKey={cls}
              name={GPS_ALERT_CLASS_LABELS[cls]}
              stackId="alerts"
              fill={ALERT_COLORS[cls]}
              radius={index === classes.length - 1 ? [4, 4, 0, 0] : undefined}
              maxBarSize={36}
              shape={dimmedBarShape(cls, active.activeIndex, focus.focusedKey, partialFrom)}
              {...motion}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <InteractiveLegend entries={legend} focus={focus} label="Clases de alerta" />
      <ChartDataTable
        caption="Alertas de conducción por clase y período"
        headers={["Período", ...classes.map((cls) => GPS_ALERT_CLASS_LABELS[cls])]}
        rows={data.map((point) => [point.title, ...classes.map((cls) => num(point.counts[cls]))])}
      />
    </ChartFrame>
  )
}
