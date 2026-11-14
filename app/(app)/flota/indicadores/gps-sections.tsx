import Link from "next/link"
import { Engine, Info, MapPin, Path, Speedometer, Timer, Truck, WifiSlash } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ChartSlot, DASHBOARD_KPI } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList, type RankedListItem } from "@/components/ui/ranked-list"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { ChartDataTable } from "@/components/charts/chart-data-table"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { vehicleIdentityParts } from "@/components/fleet/vehicle-identity"
import { bucketLabel, isPartialBucket, listBuckets, type IndicatorPeriod } from "@/lib/indicators/period"
import type {
  GpsDrivingIndicators,
  GpsIdleIndicators,
  GpsUsageIndicators,
  GpsVehicleUsage,
} from "@/lib/services/fleet-gps-indicators"
import { formatPercent, formatQty, todayInChile } from "@/lib/utils"
import { GpsAlertsChart, GpsIdleChart, GpsTripsChart, GpsUsageChart } from "./gps-charts-lazy"
import { alertBucketLabel, alertBucketTitle, hoursText, kmText, percentChange, rangeText } from "./gps-format"

const MONITORING = "/flota/monitoreo"
const IDLE_PAGE = "/combustibles/consumo/motor-en-vacio"
const COMPARED_TO = "vs. período anterior"

const GRANULARITY_NOUN = { day: "día", month: "mes" } as const

function vehicleItem(row: GpsVehicleUsage, kind: "km" | "hours"): RankedListItem {
  const { primary, secondary } = vehicleIdentityParts({ code: row.code, plate: row.plate, type: row.typeName })
  const other = kind === "km" ? (row.hours > 0 ? hoursText(row.hours) : null) : (row.km > 0 ? kmText(row.km) : null)
  return {
    key: row.vehicleId,
    label: primary,
    value: kind === "km" ? Math.round(row.km) : Math.round(row.hours * 10) / 10,
    detail: [secondary, other].filter(Boolean).join(" · ") || undefined,
    href: `/flota/${row.vehicleId}`,
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

/** Un ranking con su cabecera, su cifra de conclusión y «Ver datos». `null` sin filas. */
function Ranking({ title, description, headline, caption, items, unit, ariaLabel, dataHeaders, dataRows }: {
  title: string
  description: string
  headline: string
  caption: string
  items: RankedListItem[]
  unit: string
  ariaLabel: string
  dataHeaders: string[]
  dataRows: string[][]
}) {
  if (items.length === 0) return null
  return (
    <ChartFrame
      title={title}
      description={description}
      headline={<><ChartHeadlineValue>{headline}</ChartHeadlineValue><ChartHeadlineCaption>{caption}</ChartHeadlineCaption></>}
    >
      <RankedList items={items} format="count" unit={unit} ariaLabel={ariaLabel} limit={8} showShare={false} />
      <ChartDataTable caption={title} headers={dataHeaders} rows={dataRows} />
    </ChartFrame>
  )
}

const sharePct = (part: number, total: number) => (total > 0 ? formatPercent((part / total) * 100, 0) : "—")

// ── Sección 1: Uso de la flota ───────────────────────────────────────────────

export function UsageSection({ usage, period }: { usage: GpsUsageIndicators; period: IndicatorPeriod }) {
  const today = todayInChile()
  const noun = GRANULARITY_NOUN[period.granularity]
  const window = `${rangeText(period)} · Entel OnWay, Wialon y VisionLink`
  const links = [{ label: "Monitoreo GPS", href: MONITORING }, { label: "Vehículos", href: "/flota" }]
  const hasData = usage.km.current > 0 || usage.hours.current > 0 || usage.km.previous > 0 || usage.hours.previous > 0 || usage.vehiclesWithReadings > 0

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
  const kmTrend = percentChange(usage.km.current, usage.km.previous)
  const hoursTrend = percentChange(usage.hours.current, usage.hours.previous)

  const buckets = listBuckets(period.from, period.to, period.granularity)
  const chartData = usage.buckets.map((bucket, index) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, period.granularity),
    km: Math.round(bucket.km * 10) / 10,
    hours: Math.round(bucket.hours * 10) / 10,
    partial: index === buckets.length - 1 && isPartialBucket(bucket.key, period.granularity, today),
  }))

  const topKm = usage.topByKm
  const topKmShare = topKm.reduce((sum, row) => sum + row.km, 0)
  const topHours = usage.topByHours
  const topHoursShare = topHours.reduce((sum, row) => sum + row.hours, 0)
  const leadingWorksite = usage.byWorksite[0]

  return (
    <DashboardSection
      id="uso-flota"
      title="Uso de la flota"
      links={links}
      coverage={usage.vehiclesWithReadings < usage.fleetVehicles
        ? <CoverageLine>{`Lecturas GPS de ${usage.vehiclesWithReadings} de ${usage.fleetVehicles} vehículos de la flota: los demás no tienen medidor que informe en el período.`}</CoverageLine>
        : undefined}
      kpis={
        <>
          <KpiCard {...DASHBOARD_KPI} icon={<Path size={16} />} label="Km recorridos" value={`${formatQty(Math.round(usage.km.current))} km`}
            detail="Suma de los odómetros GPS" trend={kmTrend} trendPolarity="neutral" trendLabel={COMPARED_TO} href="/flota"
            empty={usage.km.current === 0 ? { message: "Ningún equipo registró recorrido en el período", actionLabel: "Ver Monitoreo GPS" } : undefined} />
          <KpiCard {...DASHBOARD_KPI} icon={<Timer size={16} />} label="Horas de motor" value={`${formatQty(usage.hours.current, undefined, { maximumFractionDigits: usage.hours.current >= 100 ? 0 : 1 })} h`}
            detail="Suma de los horómetros" trend={hoursTrend} trendPolarity="neutral" trendLabel={COMPARED_TO} href="/flota"
            empty={usage.hours.current === 0 ? { message: "Ningún equipo registró horas de motor en el período", actionLabel: "Ver Monitoreo GPS" } : undefined} />
          <KpiCard {...DASHBOARD_KPI} icon={<Truck size={16} />} label="Equipos con uso" value={usage.vehiclesWithUse}
            detail={`de ${usage.linkedVehicles} vinculados`} href={MONITORING}
            empty={usage.linkedVehicles === 0 ? { message: "Aún no hay equipos vinculados a un GPS", actionLabel: "Vincular dispositivos" } : undefined} />
          <KpiCard {...DASHBOARD_KPI} icon={<WifiSlash size={16} />} label="Equipos sin lecturas" value={withoutReadings}
            detail={withoutReadings > 0 ? "Vinculados sin medidor en el período" : "Todos los vinculados informaron"}
            tone={withoutReadings > 0 ? "signal" : "neutral"} href={MONITORING} />
        </>
      }
      charts={
        <>
          <ChartSlot span="wide">
            <GpsUsageChart data={chartData} description={`Por ${noun} · ${window}`} />
          </ChartSlot>
          <ChartSlot>
            {usage.byWorksite.length > 1 && leadingWorksite ? (
              <Ranking
                title="Uso por faena"
                description={`Km recorridos · ${rangeText(period)}`}
                headline={sharePct(leadingWorksite.km, usage.km.current)}
                caption={`del recorrido es de ${leadingWorksite.name}`}
                items={usage.byWorksite.map((row) => ({
                  key: row.worksiteId,
                  label: row.name,
                  value: Math.round(row.km),
                  detail: `${row.vehicles} ${row.vehicles === 1 ? "equipo" : "equipos"}${row.hours > 0 ? ` · ${hoursText(row.hours)}` : ""}`,
                }))}
                unit=" km"
                ariaLabel="Km recorridos por faena"
                dataHeaders={["Faena", "Km", "Horas de motor", "Equipos"]}
                dataRows={usage.byWorksite.map((row) => [row.name, formatQty(Math.round(row.km)), formatQty(row.hours, undefined, { maximumFractionDigits: 1 }), String(row.vehicles)])}
              />
            ) : null}
          </ChartSlot>
          <ChartSlot>
            {topKm.length > 0 ? (
              <Ranking
                title="Equipos con más recorrido"
                description={`Km recorridos, los ${topKm.length} primeros · ${rangeText(period)}`}
                headline={sharePct(topKmShare, usage.km.current)}
                caption={`del recorrido lo hacen ${topKm.length} equipos`}
                items={topKm.map((row) => vehicleItem(row, "km"))}
                unit=" km"
                ariaLabel="Equipos con más km recorridos"
                dataHeaders={["Equipo", "Faena", "Km", "Horas de motor"]}
                dataRows={topKm.map((row) => [row.code ?? row.plate, row.worksiteName, formatQty(Math.round(row.km)), formatQty(row.hours, undefined, { maximumFractionDigits: 1 })])}
              />
            ) : null}
          </ChartSlot>
          <ChartSlot span="fillXl">
            {topHours.length > 0 ? (
              <Ranking
                title="Equipos con más horas de motor"
                description={`Horas de motor, los ${topHours.length} primeros · ${rangeText(period)}`}
                headline={sharePct(topHoursShare, usage.hours.current)}
                caption={`de las horas son de ${topHours.length} equipos`}
                items={topHours.map((row) => vehicleItem(row, "hours"))}
                unit=" h"
                ariaLabel="Equipos con más horas de motor"
                dataHeaders={["Equipo", "Faena", "Horas de motor", "Km"]}
                dataRows={topHours.map((row) => [row.code ?? row.plate, row.worksiteName, formatQty(row.hours, undefined, { maximumFractionDigits: 1 }), formatQty(Math.round(row.km))])}
              />
            ) : null}
          </ChartSlot>
        </>
      }
    />
  )
}

// ── Sección 2: Ralentí y conducción ──────────────────────────────────────────

export function DrivingSection({ idle, driving, period, canViewIdle }: {
  /** `null`: sin permiso de combustibles o la consulta falló (el banner ya lo dice). */
  idle: GpsIdleIndicators | null
  driving: GpsDrivingIndicators | null
  period: IndicatorPeriod
  canViewIdle: boolean
}) {
  const today = todayInChile()
  const links = [
    ...(canViewIdle ? [{ label: "Motor en vacío", href: IDLE_PAGE }] : []),
    { label: "Monitoreo GPS", href: MONITORING },
    { label: "Vehículos", href: "/flota" },
  ]

  const idleHasData = idle !== null && idle.months.length > 0
  const tripsHaveData = driving !== null && (driving.trips.current > 0 || driving.trips.previous > 0)
  const alertsHaveData = driving !== null && (Object.values(driving.alertTotals).some((count) => count > 0) || driving.speeding.previous > 0)
  if (!idleHasData && !tripsHaveData && !alertsHaveData) {
    return (
      <DashboardSection
        id="ralenti-conduccion"
        title="Ralentí y conducción"
        links={links}
        charts={<EmptyBlock
          title="Sin viajes, alertas ni ralentí en este período"
          description="Los viajes y las alertas llegan de Entel OnWay y el ralentí de la telemetría VisionLink. Amplía el período o revisa que las fuentes estén al día en Monitoreo GPS."
          ctaLabel="Ver Monitoreo GPS"
          ctaHref={MONITORING}
        />}
      />
    )
  }

  const idleMonths = idle ? listBuckets(period.from, period.to, "month") : []
  const idleByMonth = new Map((idle?.months ?? []).map((month) => [month.key, month]))
  const idleData = idleMonths.map((key) => {
    const month = idleByMonth.get(key)
    return { key, label: bucketLabel(key, "month"), workingHours: month?.workingHours ?? null, idleHours: month?.idleHours ?? null }
  })

  const tripData = (driving?.tripBuckets ?? []).map((bucket, index, all) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, period.granularity),
    trips: bucket.trips,
    avgKm: bucket.trips > 0 ? Math.round((bucket.km / bucket.trips) * 10) / 10 : null,
    partial: index === all.length - 1 && isPartialBucket(bucket.key, period.granularity, today),
  }))
  const avgTripKm = driving && driving.trips.current > 0 ? driving.trips.km / driving.trips.current : null

  const alertBuckets = driving ? driving.alertBuckets : []
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

  const idleDelta = idle && idle.idlePct !== null && idle.previousIdlePct !== null ? idle.idlePct - idle.previousIdlePct : null
  const speedingTop = driving?.topSpeeding ?? []
  const speedingTotal = driving?.speeding.current ?? 0

  return (
    <DashboardSection
      id="ralenti-conduccion"
      title="Ralentí y conducción"
      links={links}
      coverage={
        <CoverageLine>
          {`${idle ? `El ralentí sólo incluye equipos con telemetría VisionLink (${idle.vehicles}). ` : ""}Los viajes y las alertas, sólo equipos con Entel OnWay.`}
        </CoverageLine>
      }
      kpis={
        <>
          {canViewIdle && idle && (
            <KpiCard {...DASHBOARD_KPI} icon={<Engine size={16} />} label="% del motor en ralentí"
              value={idle.idlePct === null ? "Sin dato" : formatPercent(idle.idlePct, 1)} valueKind={idle.idlePct === null ? "text" : "number"}
              detail={`${idle.vehicles} ${idle.vehicles === 1 ? "equipo" : "equipos"} con VisionLink`}
              trend={idleDelta} trendFormat="number" trendPolarity="up-bad" trendLabel={`pp ${COMPARED_TO}`}
              href={IDLE_PAGE}
              empty={idle.idlePct === null ? { message: "Sin telemetría VisionLink en el período", actionLabel: "Ver Motor en vacío" } : undefined} />
          )}
          {driving && (
            <>
              <KpiCard {...DASHBOARD_KPI} icon={<MapPin size={16} />} label="Viajes" value={driving.trips.current}
                detail="Registrados por Entel OnWay" trend={percentChange(driving.trips.current, driving.trips.previous)} trendPolarity="neutral" trendLabel={COMPARED_TO}
                href={MONITORING}
                empty={driving.trips.current === 0 ? { message: "Sin viajes registrados en el período", actionLabel: "Ver Monitoreo GPS" } : undefined} />
              <KpiCard {...DASHBOARD_KPI} icon={<Speedometer size={16} />} label="Excesos de velocidad" value={speedingTotal}
                detail="Alertas de Entel OnWay" trend={percentChange(speedingTotal, driving.speeding.previous)} trendPolarity="up-bad" trendLabel={COMPARED_TO}
                tone={speedingTotal > 0 ? "signal" : "neutral"} href={MONITORING} />
            </>
          )}
        </>
      }
      charts={
        <>
          {canViewIdle && idle && (
            <ChartSlot>
              <GpsIdleChart data={idleData} idlePct={idle.idlePct} description={`Por mes · ${rangeText(period)} · telemetría VisionLink`} />
            </ChartSlot>
          )}
          {driving && (
            <>
              <ChartSlot span={canViewIdle && idle ? "wide" : "full"}>
                <GpsTripsChart data={tripData} totalTrips={driving.trips.current} avgKm={avgTripKm} description={`Por ${GRANULARITY_NOUN[period.granularity]} · ${rangeText(period)} · Entel OnWay`} />
              </ChartSlot>
              <ChartSlot span="wide">
                <GpsAlertsChart
                  data={alertData}
                  totals={driving.alertTotals}
                  description={`Por ${driving.alertGranularity === "week" ? "semana" : "mes"} · ${rangeText(period)} · Entel OnWay · sin encendido, apagado ni movimiento`}
                />
              </ChartSlot>
              <ChartSlot span="fillXl">
                {speedingTop.length > 0 ? (
                  <Ranking
                    title="Equipos con más excesos de velocidad"
                    description={`Alertas de exceso de velocidad · ${rangeText(period)}`}
                    headline={sharePct(speedingTop.reduce((sum, row) => sum + row.count, 0), speedingTotal)}
                    caption={`de los excesos son de ${speedingTop.length} ${speedingTop.length === 1 ? "equipo" : "equipos"}`}
                    items={speedingTop.map((row) => {
                      const { primary, secondary } = vehicleIdentityParts({ code: row.code, plate: row.plate, type: row.typeName })
                      return { key: row.vehicleId, label: primary, value: row.count, detail: secondary ?? undefined, href: `/flota/${row.vehicleId}` }
                    })}
                    unit=""
                    ariaLabel="Equipos con más excesos de velocidad"
                    dataHeaders={["Equipo", "Excesos"]}
                    dataRows={speedingTop.map((row) => [row.code ?? row.plate, String(row.count)])}
                  />
                ) : null}
              </ChartSlot>
            </>
          )}
        </>
      }
    />
  )
}

