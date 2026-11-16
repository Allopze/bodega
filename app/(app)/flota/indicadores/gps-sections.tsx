import type { ReactNode } from "react"
import Link from "next/link"
import { Info, WifiSlash } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import type { BarRankingItem } from "@/components/charts/bar-ranking-chart"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { vehicleIdentityParts } from "@/components/fleet/vehicle-identity"
import { CHART_HISTORY_MONTHS, bucketLabel, chartWindowCaption, isPartialBucket, listBuckets, type IndicatorPeriod } from "@/lib/indicators/period"
import type {
  GpsDrivingIndicators,
  GpsIdleIndicators,
  GpsUsageIndicators,
  GpsVehicleUsage,
} from "@/lib/services/fleet-gps-indicators"
import { formatPercent, formatQty, todayInChile } from "@/lib/utils"
import { GpsAlertsChart, GpsIdleChart, GpsTripsChart, GpsUsageChart } from "./gps-charts-lazy"
import { alertBucketLabel, alertBucketTitle, hasComparableBase, hoursText, kmText, percentChange, rangeText } from "./gps-format"
import { layoutChartSlots, type SlotKind } from "@/lib/indicators/chart-layout"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"

const MONITORING = "/flota/monitoreo"
const IDLE_PAGE = "/combustibles/consumo/motor-en-vacio"
const COMPARED_TO = "vs. período anterior"

/** «+12 % vs. período anterior»; sin variación (sin base comparable) no hay pista. */
function trendHint(change: number | null, unit: "%" | "pp"): string | undefined {
  if (change === null || !Number.isFinite(change)) return undefined
  const rounded = Math.round(change * 10) / 10
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : ""
  return `${sign}${formatQty(Math.abs(rounded), undefined, { maximumFractionDigits: unit === "%" ? 0 : 1 })} ${unit} ${COMPARED_TO}`
}

const GRANULARITY_NOUN = { day: "día", month: "mes" } as const

function vehicleItem(row: GpsVehicleUsage, kind: "km" | "hours"): BarRankingItem {
  const { primary, secondary } = vehicleIdentityParts({ code: row.code, plate: row.plate, type: row.typeName })
  const other = kind === "km" ? (row.hours > 0 ? hoursText(row.hours) : null) : (row.km > 0 ? kmText(row.km) : null)
  return {
    key: row.vehicleId,
    label: primary,
    value: kind === "km" ? Math.round(row.km) : Math.round(row.hours * 10) / 10,
    detail: [secondary, other].filter(Boolean).join(" · ") || undefined,
    href: vehicleFichaHref(row.vehicleId),
  }
}

function CoverageLine({ children }: { children: string }) {
  return (
    <p data-coverage-notice="" className="flex items-start gap-1.5 text-xs text-[var(--color-text-muted)] text-pretty">
      <Info size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function EmptyBlock({ title, description, ctaLabel, ctaHref }: { title: string; description: string; ctaLabel: string; ctaHref: string }) {
  return (
    <ChartSlot span="full">
      <EmptyState
        compact
        icon={<WifiSlash size={20} />}
        title={title}
        description={description}
        action={<Button asChild variant="secondary" size="sm"><Link href={ctaHref}>{ctaLabel}</Link></Button>}
      />
    </ChartSlot>
  )
}

/**
 * Las celdas del panel de gráficos. Cuáles existen se sabe aquí (un gráfico sin datos no
 * se agrega), y `layoutChartSlots` elige el ancho de cada una para que ninguna fila quede
 * a medias en `xl` ni en `2xl`.
 */
function ChartSlots({ slots }: { slots: Array<{ key: string; kind: SlotKind; node: ReactNode }> }) {
  const spans = layoutChartSlots(slots.map((slot) => slot.kind))
  return <>{slots.map((slot, index) => <ChartSlot key={slot.key} span={spans[index]}>{slot.node}</ChartSlot>)}</>
}

/** Un ranking con su cabecera, su cifra de conclusión y «Ver datos». `null` sin filas. */
function Ranking({ title, description, headline, caption, items, unit, ariaLabel, dataHeaders, dataRows, excel }: {
  title: string
  description: string
  headline: string
  caption: string
  items: BarRankingItem[]
  unit: string
  ariaLabel: string
  dataHeaders: string[]
  dataRows: string[][]
  excel?: ChartDataExcel
}) {
  if (items.length === 0) return null
  return (
    <ChartFrame
      title={title}
      description={description}
      headline={<><ChartHeadlineValue>{headline}</ChartHeadlineValue><ChartHeadlineCaption>{caption}</ChartHeadlineCaption></>}
    >
      <BarRankingChartLazy items={items} unit={unit} ariaLabel={ariaLabel} limit={8} order="desc" />
      <ChartDataTable caption={title} headers={dataHeaders} rows={dataRows} excel={excel} />
    </ChartFrame>
  )
}

/**
 * «Uso por faena»: km y horas de motor, un ranking por unidad (A5b). Sólo con km, una faena de
 * grúas o cargadores (que se miden en horas) no aparecía, y la celda quedaba a medio llenar junto
 * al gráfico mensual (crítica 2026-11-15).
 */
function WorksiteUsage({ usage, period, leading, excel }: { usage: GpsUsageIndicators; period: IndicatorPeriod; leading: GpsUsageIndicators["byWorksite"][number]; excel?: ChartDataExcel }) {
  const equipment = (count: number) => `${count} ${count === 1 ? "equipo" : "equipos"}`
  const byKm = usage.byWorksite.filter((row) => row.km > 0).map((row) => ({
    key: row.worksiteId,
    label: row.name,
    value: Math.round(row.km),
    detail: equipment(row.vehicles),
  }))
  const byHours = usage.byWorksite.filter((row) => row.hours > 0).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, "es")).map((row) => ({
    key: row.worksiteId,
    label: row.name,
    value: Math.round(row.hours * 10) / 10,
    detail: equipment(row.vehicles),
  }))
  const subhead = "text-xs font-semibold text-[var(--color-text-muted)]"
  return (
    <ChartFrame
      title="Uso por faena"
      description={`${byHours.length > 0 ? "Km recorridos y horas de motor" : "Km recorridos"} · ${rangeText(period)}`}
      headline={<><ChartHeadlineValue>{sharePct(leading.km, usage.km.current)}</ChartHeadlineValue><ChartHeadlineCaption>{`del recorrido es de ${leading.name}`}</ChartHeadlineCaption></>}
    >
      {byKm.length > 0 && (
        <>
          {byHours.length > 0 && <p className={subhead}>Km recorridos</p>}
          <BarRankingChartLazy items={byKm} unit=" km" ariaLabel="Km recorridos por faena" limit={8} order="desc" />
        </>
      )}
      {byHours.length > 0 && (
        <>
          <p className={`${subhead} ${byKm.length > 0 ? "mt-4" : ""}`}>Horas de motor</p>
          <BarRankingChartLazy items={byHours} unit=" h" ariaLabel="Horas de motor por faena" limit={8} order="desc" />
        </>
      )}
      <ChartDataTable
        caption="Uso por faena"
        headers={["Faena", "Km", "Horas de motor", "Equipos"]}
        rows={usage.byWorksite.map((row) => [row.name, formatQty(Math.round(row.km)), formatQty(row.hours, undefined, { maximumFractionDigits: 1 }), String(row.vehicles)])}
        excel={excel}
      />
    </ChartFrame>
  )
}

const sharePct = (part: number, total: number) => (total > 0 ? formatPercent((part / total) * 100, 0) : "—")

/**
 * Qué muestra un ranking de equipos: todos los que tienen el dato o los primeros de cuántos.
 * «Km recorridos, los 1 primeros» no decía si había más.
 */
function rankingScope(what: string, shown: number, total: number, range: string): string {
  return shown < total ? `${what}, los ${shown} con más de ${total} equipos · ${range}` : `${what} por equipo · ${range}`
}

/** Cómo se nombra al primero de un ranking: su código y, sin él, la patente. */
const leaderName = (row: { code: string | null; plate: string; typeName: string }) => vehicleIdentityParts({ code: row.code, plate: row.plate, type: row.typeName }).primary

// ── Sección 1: Uso de la flota ───────────────────────────────────────────────

/**
 * «Exportar Excel» de las tablas «Ver datos»: con `flota:export`, cada tabla se suma a la descarga
 * del tablero. `scope` lleva la nota del período (rankings) y `chart`, la de la ventana del gráfico
 * (las series, que miran seis meses cuando el período es corto). Sin el permiso, `undefined`.
 */
export interface GpsExcel {
  scope: ChartDataExcel
  chart: ChartDataExcel
}

export function UsageSection({ usage, period, excel }: { usage: GpsUsageIndicators; period: IndicatorPeriod; excel?: GpsExcel }) {
  const today = todayInChile()
  const { chart } = period
  const noun = GRANULARITY_NOUN[chart.granularity]
  // La serie sigue a la ventana del gráfico (seis meses si el período es corto); los rankings, al período.
  const window = `${chartWindowCaption(chart, rangeText)} · Entel OnWay, Wialon y VisionLink`
  const links = [{ label: "Monitoreo GPS", href: MONITORING }, { label: "Vehículos", href: "/flota" }]
  const hasData = usage.km.current > 0 || usage.hours.current > 0 || usage.km.previous > 0 || usage.hours.previous > 0 || usage.vehiclesWithReadings > 0
    || usage.buckets.some((bucket) => bucket.km > 0 || bucket.hours > 0)

  if (!hasData) {
    return (
      <DashboardSection
        id="uso-flota"
        title="Uso de la flota"
        links={links}
        charts={usage.linkedVehicles > 0
          ? <EmptyBlock title="Los equipos vinculados no informaron medidor en este período" description="Los km y las horas salen de los medidores que informan Entel OnWay, Wialon y VisionLink. Revisa el estado de las fuentes en Monitoreo GPS o amplía el período." ctaLabel="Ver Monitoreo GPS" ctaHref={MONITORING} />
          : <EmptyBlock title="Aún no hay equipos con GPS vinculado" description="Vincula los dispositivos de Entel OnWay o Wialon a los vehículos de la flota para ver su recorrido y sus horas de motor." ctaLabel="Vincular dispositivos" ctaHref={MONITORING} />}
      />
    )
  }

  const withoutReadings = Math.max(0, usage.linkedVehicles - usage.vehiclesWithReadings)
  // Una variación de «+480 %» suele decir que el período anterior casi no tenía lecturas, no que el uso se disparó.
  const comparable = hasComparableBase(usage.readingDays.current, usage.readingDays.previous)
  const kmTrend = comparable ? percentChange(usage.km.current, usage.km.previous) : null
  const hoursTrend = comparable ? percentChange(usage.hours.current, usage.hours.previous) : null

  const chartData = usage.buckets.map((bucket, index, all) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, chart.granularity),
    km: Math.round(bucket.km * 10) / 10,
    hours: Math.round(bucket.hours * 10) / 10,
    partial: index === all.length - 1 && isPartialBucket(bucket.key, chart.granularity, today),
  }))

  const topKm = usage.topByKm
  const topHours = usage.topByHours
  const leadingWorksite = usage.byWorksite[0]

  return (
    <DashboardSection
      id="uso-flota"
      title="Uso de la flota"
      links={links}
      // Una sola base para toda la sección: los vehículos con GPS. Antes la línea de cobertura contaba
      // los que informaron sobre la flota, la tira «de N vinculados» y el ranking «lo hacen N equipos»:
      // tres denominadores para la misma pregunta (crítica 2026-11-15, paso 5).
      coverage={usage.linkedVehicles < usage.fleetVehicles
        ? <CoverageLine>{`${usage.linkedVehicles} de los ${usage.fleetVehicles} vehículos de la flota tienen GPS (Entel OnWay, Wialon o VisionLink): las cifras de esta sección son de ellos.`}</CoverageLine>
        : undefined}
      summary={<SummaryBar numerals="sans" stats={[
        {
          key: "km",
          label: "Km recorridos",
          value: `${formatQty(Math.round(usage.km.current))} km`,
          hint: trendHint(kmTrend, "%"),
          href: "/flota",
        },
        {
          key: "horas",
          label: "Horas de motor",
          value: `${formatQty(usage.hours.current, undefined, { maximumFractionDigits: usage.hours.current >= 100 ? 0 : 1 })} h`,
          hint: trendHint(hoursTrend, "%"),
          href: "/flota",
        },
        {
          key: "equipos-con-uso",
          label: "Equipos con uso",
          value: usage.vehiclesWithUse,
          secondary: `de ${usage.linkedVehicles} con GPS`,
          href: MONITORING,
        },
        {
          key: "sin-lecturas",
          label: "Equipos sin lecturas",
          value: withoutReadings,
          secondary: withoutReadings > 0 ? "Con GPS y sin lecturas en el período" : "Todos los que tienen GPS informaron",
          tone: "signal",
          href: MONITORING,
        },
      ]} />}
      charts={<ChartSlots slots={[
        ...(chartData.some((point) => point.km > 0 || point.hours > 0) ? [{
          key: "uso",
          kind: "one" as const,
          node: <GpsUsageChart data={chartData} granularity={chart.granularity} description={`Por ${noun} · ${window}`} excel={excel?.chart} />,
        }] : []),
        ...(usage.byWorksite.length > 1 && leadingWorksite ? [{
          key: "faenas",
          kind: "one" as const,
          node: <WorksiteUsage usage={usage} period={period} leading={leadingWorksite} excel={excel?.scope} />,
        }] : []),
        ...(topKm.length > 0 ? [{
          key: "equipos-km",
          kind: "one" as const,
          node: (
            <Ranking
              title="Equipos con más recorrido"
              description={rankingScope("Km recorridos", topKm.length, usage.vehiclesWithKm, rangeText(period))}
              // Cuánto pesa el primero: «los N primeros hacen el 100 %» no decía nada cuando eran todos.
              headline={sharePct(topKm[0]!.km, usage.km.current)}
              caption={`del recorrido es de ${leaderName(topKm[0]!)}`}
              items={topKm.map((row) => vehicleItem(row, "km"))}
              unit=" km"
              ariaLabel="Equipos con más km recorridos"
              dataHeaders={["Equipo", "Faena", "Km", "Horas de motor"]}
              dataRows={topKm.map((row) => [row.code ?? row.plate, row.worksiteName, formatQty(Math.round(row.km)), formatQty(row.hours, undefined, { maximumFractionDigits: 1 })])}
              excel={excel?.scope}
            />
          ),
        }] : []),
        ...(topHours.length > 0 ? [{
          key: "equipos-horas",
          kind: "one" as const,
          node: (
            <Ranking
              title="Equipos con más horas de motor"
              description={rankingScope("Horas de motor", topHours.length, usage.vehiclesWithHours, rangeText(period))}
              headline={sharePct(topHours[0]!.hours, usage.hours.current)}
              caption={`de las horas de motor son de ${leaderName(topHours[0]!)}`}
              items={topHours.map((row) => vehicleItem(row, "hours"))}
              unit=" h"
              ariaLabel="Equipos con más horas de motor"
              dataHeaders={["Equipo", "Faena", "Horas de motor", "Km"]}
              dataRows={topHours.map((row) => [row.code ?? row.plate, row.worksiteName, formatQty(row.hours, undefined, { maximumFractionDigits: 1 }), formatQty(Math.round(row.km))])}
              excel={excel?.scope}
            />
          ),
        }] : []),
      ]} />}
    />
  )
}

// ── Sección 2: Motor en vacío y conducción ──────────────────────────────────────────

export function DrivingSection({ idle, driving, period, canViewIdle, excel }: {
  /** `null`: sin permiso de combustibles o la consulta falló (el banner ya lo dice). */
  idle: GpsIdleIndicators | null
  driving: GpsDrivingIndicators | null
  period: IndicatorPeriod
  canViewIdle: boolean
  excel?: GpsExcel
}) {
  const today = todayInChile()
  const { chart } = period
  const links = [
    ...(canViewIdle ? [{ label: "Motor en vacío", href: IDLE_PAGE }] : []),
    { label: "Monitoreo GPS", href: MONITORING },
    { label: "Vehículos", href: "/flota" },
  ]

  // Las series miran la ventana del gráfico: con el período vacío puede haber historia que mostrar.
  const alertBuckets = driving ? driving.alertBuckets : []
  const alertChartTotals = alertBuckets.reduce((acc, bucket) => {
    for (const cls of Object.keys(acc) as Array<keyof typeof acc>) acc[cls] += bucket.counts[cls]
    return acc
  }, { speeding: 0, harsh_driving: 0, pothole: 0, idle: 0, other: 0 })
  const chartTrips = driving ? driving.tripBuckets.reduce((sum, bucket) => sum + bucket.trips, 0) : 0
  const idleHasData = idle !== null && idle.months.length > 0
  const tripsHaveData = driving !== null && (driving.trips.current > 0 || driving.trips.previous > 0 || chartTrips > 0)
  const alertsHaveData = driving !== null && (Object.values(driving.alertTotals).some((count) => count > 0) || driving.speeding.previous > 0 || Object.values(alertChartTotals).some((count) => count > 0))
  if (!idleHasData && !tripsHaveData && !alertsHaveData) {
    return (
      <DashboardSection
        id="ralenti-conduccion"
        title="Motor en vacío y conducción"
        links={links}
        charts={<EmptyBlock
          title="Sin viajes, alertas ni horas de motor en este período"
          description="Los viajes y las alertas llegan de Entel OnWay y las horas de motor en vacío, de la telemetría VisionLink. Amplía el período o revisa que las fuentes estén al día en Monitoreo GPS."
          ctaLabel="Ver Monitoreo GPS"
          ctaHref={MONITORING}
        />}
      />
    )
  }

  const idleMonths = idle ? listBuckets(chart.from, chart.to, "month") : []
  const idleByMonth = new Map((idle?.months ?? []).map((month) => [month.key, month]))
  const idleData = idleMonths.map((key) => {
    const month = idleByMonth.get(key)
    return {
      key,
      label: bucketLabel(key, "month"),
      workingHours: month?.workingHours ?? null,
      idleHours: month?.idleHours ?? null,
      partial: isPartialBucket(key, "month", today),
    }
  })

  const tripData = (driving?.tripBuckets ?? []).map((bucket, index, all) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, chart.granularity),
    trips: bucket.trips,
    avgKm: bucket.trips > 0 ? Math.round((bucket.km / bucket.trips) * 10) / 10 : null,
    partial: index === all.length - 1 && isPartialBucket(bucket.key, chart.granularity, today),
  }))

  const lastAlertKey = alertBuckets.at(-1)?.key
  const alertData = driving
    ? alertBuckets.map((bucket) => ({
        key: bucket.key,
        label: alertBucketLabel(bucket.key, driving.alertGranularity),
        title: alertBucketTitle(bucket.key, driving.alertGranularity),
        counts: bucket.counts,
        partial: bucket.key === lastAlertKey && period.to >= today,
      }))
    : []

  const idleComparable = idle !== null && hasComparableBase(idle.operatingHours.current, idle.operatingHours.previous)
  const idleDelta = idle && idleComparable && idle.idlePct !== null && idle.previousIdlePct !== null ? idle.idlePct - idle.previousIdlePct : null
  const drivingComparable = driving !== null && hasComparableBase(driving.coverageDays.current, driving.coverageDays.previous)
  const speedingTop = driving?.topSpeeding ?? []
  const speedingTotal = driving?.speeding.current ?? 0

  const drivingStats: SummaryStat[] = [
    ...(canViewIdle && idle ? [{
      key: "ralenti",
      label: "% de horas de motor en vacío",
      value: idle.idlePct === null ? "Sin dato" : formatPercent(idle.idlePct, 1),
      valueKind: idle.idlePct === null ? ("text" as const) : ("number" as const),
      hint: trendHint(idleDelta, "pp"),
      secondary: idle.idlePct === null ? "Sin telemetría VisionLink en el período" : `${idle.vehicles} ${idle.vehicles === 1 ? "equipo" : "equipos"} con VisionLink`,
      href: IDLE_PAGE,
    }] : []),
    ...(driving ? [
      {
        key: "viajes",
        label: "Viajes",
        value: driving.trips.current,
        hint: trendHint(drivingComparable ? percentChange(driving.trips.current, driving.trips.previous) : null, "%"),
        secondary: "Registrados por Entel OnWay",
        href: MONITORING,
      },
      {
        key: "excesos",
        label: "Excesos de velocidad",
        value: speedingTotal,
        hint: trendHint(drivingComparable ? percentChange(speedingTotal, driving.speeding.previous) : null, "%"),
        secondary: "Alertas de Entel OnWay",
        tone: "signal" as const,
        href: MONITORING,
      },
    ] : []),
  ]

  return (
    <DashboardSection
      id="ralenti-conduccion"
      title="Motor en vacío y conducción"
      links={links}
      coverage={
        <CoverageLine>
          {`${idle ? `El motor en vacío sólo incluye equipos con telemetría VisionLink (${idle.vehicles}). ` : ""}Los viajes y las alertas, sólo equipos con Entel OnWay.`}
        </CoverageLine>
      }
      summary={drivingStats.length > 0 ? <SummaryBar numerals="sans" stats={drivingStats} /> : undefined}
      charts={<ChartSlots slots={[
        ...(canViewIdle && idle && idleData.some((point) => (point.workingHours ?? 0) + (point.idleHours ?? 0) > 0) ? [{
          key: "ralenti",
          kind: "one" as const,
          node: <GpsIdleChart data={idleData} description={`Por mes · ${chartWindowCaption(chart, rangeText)} · telemetría VisionLink`} excel={excel?.chart} />,
        }] : []),
        ...(driving && chartTrips > 0 ? [{
          key: "viajes",
          kind: "one" as const,
          node: <GpsTripsChart data={tripData} totalTrips={chartTrips} granularity={chart.granularity} description={`Por ${GRANULARITY_NOUN[chart.granularity]} · ${chartWindowCaption(chart, rangeText)} · Entel OnWay`} excel={excel?.chart} />,
        }] : []),
        ...(driving && Object.values(alertChartTotals).some((count) => count > 0) ? [{
          key: "alertas",
          kind: "one" as const,
          node: (
            <GpsAlertsChart
              data={alertData}
              totals={alertChartTotals}
              totalCaption={chart.isHistory ? `alertas en los últimos ${CHART_HISTORY_MONTHS} meses` : "alertas en el período"}
              description={`Por ${driving.alertGranularity === "week" ? "semana" : "mes"} · ${chartWindowCaption(chart, rangeText)} · Entel OnWay · sin encendido, apagado ni movimiento`}
              excel={excel?.chart}
            />
          ),
        }] : []),
        ...(speedingTop.length > 0 ? [{
          key: "excesos",
          kind: "one" as const,
          node: (
            <Ranking
              title="Equipos con más excesos de velocidad"
              description={rankingScope("Alertas de exceso de velocidad", speedingTop.length, driving?.speedingVehicles ?? speedingTop.length, rangeText(period))}
              headline={sharePct(speedingTop[0]!.count, speedingTotal)}
              caption={`de los excesos son de ${leaderName(speedingTop[0]!)}`}
              items={speedingTop.map((row) => {
                const { primary, secondary } = vehicleIdentityParts({ code: row.code, plate: row.plate, type: row.typeName })
                return { key: row.vehicleId, label: primary, value: row.count, detail: secondary ?? undefined, href: vehicleFichaHref(row.vehicleId) }
              })}
              unit=""
              ariaLabel="Equipos con más excesos de velocidad"
              dataHeaders={["Equipo", "Excesos"]}
              dataRows={speedingTop.map((row) => [row.code ?? row.plate, String(row.count)])}
              excel={excel?.scope}
            />
          ),
        }] : []),
      ]} />}
    />
  )
}

