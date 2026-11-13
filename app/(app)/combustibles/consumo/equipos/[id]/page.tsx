import type * as React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowSquareOut, CaretRight } from "@phosphor-icons/react/dist/ssr"
import { SeverityBadge } from "@/app/(app)/analitica/analytics-ranking-table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { ChartSection } from "@/components/charts/chart-section"
import { CoverageNotice } from "@/components/charts/coverage-notice"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { PERFORMANCE_FAMILY_LABELS, PERFORMANCE_FAMILY_SLUGS, PERFORMANCE_UNIT_LABELS, PERFORMANCE_UNIT_TITLES, STAT_MISSING } from "@/lib/combustibles/control/contracts"
import { WORSE_PERFORMANCE_THRESHOLD_PCT } from "@/lib/combustibles/control/view-helpers"
import { fuelSourcesHref } from "@/lib/combustibles/coverage-notice"
import { getFuelProviderCoverageGaps } from "@/lib/combustibles/coverage-notice-data"
import { getEquipmentFile } from "@/lib/combustibles/equipment/get-equipment-file"
import { describeIdleDaily, idleDailyChartData, idleDailyTable } from "@/lib/combustibles/equipment/idle-daily"
import { litersWindowLabel } from "@/lib/combustibles/equipment/liters-by-month"
import type { EquipmentFile } from "@/lib/combustibles/equipment/types"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, fuelPerformanceHref } from "@/lib/combustibles/routes"
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { IdleDailyChartLazy } from "../../_components/charts/idle-charts-lazy"
import { hrefInContext } from "../../_components/page-links"
import { RegularityBadge } from "../../rendimiento/[familia]/stats-tables"
import { EquipmentLitersChart } from "./equipment-liters-chart-lazy"
import { EquipmentLoadsTable } from "./equipment-loads-table"
import { EquipmentPerformanceChart } from "./equipment-performance-chart-lazy"

export const metadata: Metadata = { title: "Equipo" }

type SearchParams = Record<string, string | string[] | undefined>

const METER_LABEL = { odometer: "Odómetro (km)", hour_meter: "Horómetro (h)", none: "Sin medidor" } as const
const KIND_LABEL = { carga: "Carga por decidir", caso: "Caso", pedido: "Pedido de revisión" } as const

function signedPct(value: number | null): string {
  if (value === null) return STAT_MISSING
  const text = formatQty(Math.abs(value), undefined, { maximumFractionDigits: 1 })
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${text} %`
}

const stat = (value: number | null) => (value === null ? STAT_MISSING : formatQty(value, undefined, { maximumFractionDigits: 2 }))

export default async function FichaEquipoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.consumo) } catch { redirect("/forbidden") }
  const { id } = await params
  const period = await resolveFuelPeriodForPage(session, await searchParams)

  // `null` si el equipo no existe o queda fuera de la faena de quien consulta: el mismo 404 en los dos casos.
  const file = await getEquipmentFile(session, id, period)
  if (!file) notFound()

  const { vehicle, loads, performance, litersByMonth, idle, seals, cases, degraded, sourceCount } = file
  // Sin cargas en ninguno de los 12 meses (o con la consulta caída, que `degraded` ya avisa) la sección no se pinta.
  const hasLitersHistory = litersByMonth.some((month) => month.liters > 0)
  // Los 12 meses de «Litros por mes»: los que Copec no informó no son «cero litros» (un mes sin cargas se dibuja en 0 y
  // se lee como «no se cargó»). Sólo se consulta si el gráfico se va a pintar.
  const coverage = hasLitersHistory
    ? await settle(getFuelProviderCoverageGaps(session, litersByMonth.map((month) => month.month)), { gapMonths: [], partialMonths: [] }, "equipo-cobertura")
    : null
  const unitLabel = vehicle.unit ? PERFORMANCE_UNIT_LABELS[vehicle.unit] : null
  const inContext = (href: string) => hrefInContext(href, period)
  const canSeeFlota = can(session, "flota:view")
  const canExport = can(session, "combustibles:export")
  const description = [vehicle.typeName, [vehicle.brand, vehicle.model].filter(Boolean).join(" "), vehicle.worksiteName].filter(Boolean).join(" · ")
  const familyHref = vehicle.family ? inContext(fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS[vehicle.family])) : null

  const stats = buildStats(file, { periodLabel: period.inLabel, motorHref: inContext(`${FUEL_PATHS.consumoMotorVacio}?equipo=${encodeURIComponent(vehicle.id)}`), sealsHref: inContext(`${FUEL_PATHS.cuadraturaSellos}?equipo=${encodeURIComponent(vehicle.id)}`) })

  return (
    <PageContainer>
      <PageHeader
        title={vehicle.label}
        description={description}
        breadcrumb={<FuelBreadcrumbs items={[
          { label: "Consumo", href: FUEL_PATHS.consumo },
          ...(familyHref && vehicle.family ? [{ label: `Rendimiento · ${PERFORMANCE_FAMILY_LABELS[vehicle.family]}`, href: familyHref }] : []),
          { label: vehicle.label },
        ]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <DegradedDataBanner degraded={degraded} total={sourceCount} />
      {!vehicle.isActive ? <p className="mb-4"><Badge variant="neutral" size="sm">Equipo inactivo</Badge></p> : null}

      <SummaryBar stats={stats} className="mb-8" />

      <div className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card id="rendimiento" className="p-6">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-base">Rendimiento carga a carga</CardTitle>
            <CardDescription>
              {performance?.normalRange && vehicle.unit
                ? <>La franja verde es su rango normal ({formatQty(performance.normalRange.low, undefined, { maximumFractionDigits: 1 })} a {formatQty(performance.normalRange.high, undefined, { maximumFractionDigits: 1 })} {unitLabel}), calculado con su historial.</>
                : "Las últimas cargas del equipo con su rendimiento calculado."}
              {performance?.outOfRangeSince && vehicle.unit ? (
                <> Desde el {formatDate(performance.outOfRangeSince.at)} rinde {vehicle.unit === "km_per_liter" ? "bajo" : "sobre"} ese rango.</>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!vehicle.unit ? (
              <EmptyState compact title="Este equipo no mide rendimiento" description="No tiene odómetro ni horómetro configurado, así que no hay km/L ni L/h que calcular. Se configura en la ficha del equipo, en Flota." />
            ) : performance ? (
              <div className="grid gap-5">
                <EquipmentPerformanceChart unit={vehicle.unit} points={performance.series} range={performance.normalRange} vehicleLabel={vehicle.label} />
                <PerformanceFacts performance={performance} periodLabel={period.inLabel} />
              </div>
            ) : (
              <EmptyState compact title="Sin cargas con rendimiento en este período" description="El equipo no tiene cargas que cuenten en el período ni historial con rendimiento calculado. Cambia el período o revisa sus cargas." />
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card className="p-6" aria-labelledby="pendiente-title">
            <CardHeader className="p-0 pb-3">
              <CardTitle id="pendiente-title" className="text-base">Pendiente</CardTitle>
              <CardDescription>Cargas por decidir, casos y pedidos de revisión de este equipo.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {cases.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">Nada pendiente en este equipo.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {cases.map((item) => (
                    <li key={item.key}>
                      <Link href={item.href} className="group flex items-start gap-3 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                        <span className="min-w-0 flex-1">
                          <span className="text-eyebrow block">{KIND_LABEL[item.kind]} · desde el {formatDate(item.since)}</span>
                          <span className="block text-sm font-medium text-[var(--color-text)] group-hover:text-[var(--color-primary-ink)]">{item.title}</span>
                          {item.detail ? <span className="block text-xs text-[var(--color-text-muted)]">{item.detail}</span> : null}
                        </span>
                        {item.severity ? <SeverityBadge severity={item.severity} /> : null}
                        <CaretRight size={14} aria-hidden className="mt-1 shrink-0 text-[var(--color-text-faint)]" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="p-6" aria-labelledby="datos-title">
            <CardHeader className="p-0 pb-3">
              <CardTitle id="datos-title" className="text-base">Datos del equipo</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                <Fact label="Tipo" value={vehicle.typeName} />
                <Fact label="Marca y modelo" value={[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || STAT_MISSING} />
                <Fact label="Patente" value={vehicle.plate} mono />
                <Fact label="Faena" value={vehicle.worksiteName} />
                <Fact label="Medidor" value={METER_LABEL[vehicle.meterType]} />
                <Fact label="Rinde en" value={vehicle.unit ? <abbr title={PERFORMANCE_UNIT_TITLES[vehicle.unit]} className="no-underline">{unitLabel}</abbr> : "No mide rendimiento"} />
                <Fact label="Estanque" value={vehicle.tankCapacityLiters === null ? STAT_MISSING : `${formatQty(vehicle.tankCapacityLiters, undefined, { maximumFractionDigits: 0 })} L`} mono />
                <Fact label="Proveedor habitual" value={vehicle.usualSupplierName ?? STAT_MISSING} />
              </dl>
              {canSeeFlota ? (
                <Link href={`/flota/${encodeURIComponent(vehicle.id)}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
                  Ver la ficha en Flota <ArrowSquareOut size={14} aria-hidden />
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {hasLitersHistory ? (
        <section id="litros" aria-labelledby="litros-title" className="mb-10 scroll-mt-4">
          <h2 id="litros-title" className="text-h2 text-[var(--color-text)]">Litros por mes</h2>
          <p className="mb-3 mt-0.5 text-sub">{litersWindowLabel(period.to.slice(0, 7), period.status)}; el período elegido en tono más fuerte.</p>
          {coverage && (
            <CoverageNotice
              className="mb-3"
              gapMonths={coverage.gapMonths}
              partialMonths={coverage.partialMonths}
              subject="los litros cargados con tarjeta Copec"
              sourcesHref={fuelSourcesHref(session) ? inContext(FUEL_PATHS.fuentes) : undefined}
            />
          )}
          <EquipmentLitersChart months={litersByMonth} periodMonths={period.monthKeys} vehicleLabel={vehicle.label} />
        </section>
      ) : null}

      <section id="cargas" aria-labelledby="cargas-title" className="mb-10 scroll-mt-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="cargas-title" className="text-h2 text-[var(--color-text)]">Últimas cargas</h2>
            <p className="mt-0.5 text-sub">
              {loads.count === 0 ? `Sin cargas en ${period.inLabel}.` : `${formatQty(loads.count)} ${loads.count === 1 ? "carga" : "cargas"} y ${formatQty(Math.round(loads.liters))} L en ${period.inLabel}. La fecha abre la ficha de la carga.`}
            </p>
          </div>
          <Link href={inContext(`${FUEL_PATHS.cargas}?q=${encodeURIComponent(vehicle.plate)}`)} className="text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
            Ver todas las cargas del equipo
          </Link>
        </div>
        <EquipmentLoadsTable rows={loads.rows} unit={vehicle.unit} />
        {loads.hiddenCount > 0 ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">Hay {formatQty(loads.hiddenCount)} {loads.hiddenCount === 1 ? "carga más" : "cargas más"} en el período; «Ver todas las cargas del equipo» las trae.</p> : null}
      </section>

      {idle ? (
        <section id="motor" aria-labelledby="motor-title" className="mb-10 scroll-mt-4">
          <h2 id="motor-title" className="text-h2 text-[var(--color-text)]">Motor en vacío</h2>
          <p className="mb-3 mt-0.5 text-sub">
            Horas con el motor encendido sin trabajar en {period.inLabel}, según la telemetría.{" "}
            <Link href={inContext(`${FUEL_PATHS.consumoMotorVacio}?equipo=${encodeURIComponent(vehicle.id)}`)} className="font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">Ver día a día</Link>
          </p>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 border-y border-[var(--color-border)] py-3 text-sm">
            <Metric label="Horas de motor" value={`${formatQty(idle.operatingHours, undefined, { maximumFractionDigits: 1 })} h`} />
            <Metric label="En vacío" value={idle.idlePct === null ? STAT_MISSING : `${formatQty(idle.idlePct, undefined, { maximumFractionDigits: 1 })} %`} />
            <Metric label="Horas en vacío" value={`${formatQty(idle.idleHours, undefined, { maximumFractionDigits: 1 })} h`} />
            <Metric label="Días con actividad" value={formatQty(idle.activeDays)} />
            <Metric label="Litros en vacío" value={idle.litersIdle === null ? STAT_MISSING : `${formatQty(idle.litersIdle, undefined, { maximumFractionDigits: 1 })} L`} />
          </dl>
          <ChartSection
            bare
            headingLevel={3}
            className="mt-4"
            title="Horas de motor y % en vacío, día a día"
            summary={describeIdleDaily(idle.daily) ?? undefined}
            data={{ caption: `Horas de motor y porcentaje en vacío por día de ${vehicle.label}`, ...idleDailyTable(idle.daily), ...(canExport ? { excel: { permission: "combustibles:export" as const } } : {}) }}
            // Sin ninguna hora de motor en el período no hay barra que dibujar: los ejes
            // vacíos se leían como un gráfico roto (recorrido del 2026-11-04).
            empty={idle.daily.some((day) => day.operatingHours > 0) ? null : {
              label: "Sin horas de motor en este período",
              hint: "La telemetría no registró funcionamiento en estos días. Elige un período anterior para ver el detalle por día.",
            }}
          >
            <IdleDailyChartLazy data={idleDailyChartData(idle.daily)} ariaLabel={`Horas de motor por día y porcentaje en vacío de ${vehicle.label}`} />
          </ChartSection>
        </section>
      ) : null}

      {seals ? (
        <section id="sellos" aria-labelledby="sellos-title" className="mb-10 scroll-mt-4">
          <h2 id="sellos-title" className="text-h2 text-[var(--color-text)]">Cadena de sellos</h2>
          <p className="mb-3 mt-0.5 text-sub">El sello que se retira debe ser el que se puso en la carga anterior del mismo equipo.</p>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {seals.loads === 0 ? (
              <Badge variant="neutral" size="sm">Sin cargas con sello en el período</Badge>
            ) : seals.mismatches === 0 ? (
              <Badge variant="success" size="sm">Cadena correcta</Badge>
            ) : (
              <Badge variant="danger" size="sm">{formatQty(seals.mismatches)} {seals.mismatches === 1 ? "carga con la cadena rota" : "cargas con la cadena rota"}</Badge>
            )}
            <span className="text-[var(--color-text-muted)]">{formatQty(seals.loads)} {seals.loads === 1 ? "carga" : "cargas"} en el período{seals.withoutSeal > 0 ? ` · ${formatQty(seals.withoutSeal)} sin sello (con motivo)` : ""}</span>
            {seals.lastInstalledSeal ? <span className="text-[var(--color-text-muted)]">Último sello instalado: <span className="font-mono text-[var(--color-text)]">{seals.lastInstalledSeal}</span>{seals.lastLoadAt ? ` (${formatDateTime(seals.lastLoadAt)})` : ""}</span> : null}
            <Link href={inContext(`${FUEL_PATHS.cuadraturaSellos}?equipo=${encodeURIComponent(vehicle.id)}`)} className="font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">Ver el historial de sellos</Link>
          </div>
          {seals.issues.length > 0 ? (
            <ul aria-label="Cargas con la cadena de sellos rota" className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] text-sm">
              {seals.issues.map((issue) => (
                <li key={issue.submissionId} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2">
                  <Link href={`${FUEL_PATHS.cargas}/terreno/${encodeURIComponent(issue.submissionId)}`} className="font-medium underline-offset-2 hover:underline">{formatDateTime(issue.loadedAt)}</Link>
                  <span className="text-[var(--color-text-muted)]">Retiró el sello <span className="font-mono text-[var(--color-text)]">{issue.removedSeal ?? STAT_MISSING}</span></span>
                  <span className="text-[var(--color-text-muted)]">Debía retirar el <span className="font-mono text-[var(--color-text)]">{issue.expectedSeal ?? STAT_MISSING}</span></span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </PageContainer>
  )
}

function buildStats(file: EquipmentFile, links: { periodLabel: string; motorHref: string; sealsHref: string }): SummaryStat[] {
  const { vehicle, loads, performance, idle, seals } = file
  const unitLabel = vehicle.unit ? PERFORMANCE_UNIT_LABELS[vehicle.unit] : null
  const worse = performance ? performance.worseThanModel || performance.worseThanHistory : false
  const items: SummaryStat[] = []

  if (!vehicle.unit) {
    items.push({ key: "rendimiento", label: "Rendimiento", value: "No mide rendimiento", valueKind: "text", href: "#rendimiento" })
  } else if (performance?.mean != null) {
    items.push({
      key: "rendimiento",
      label: `Rendimiento en ${links.periodLabel}`,
      value: `${stat(performance.mean)} ${unitLabel}`,
      hint: worse ? "Rinde peor" : undefined,
      tone: worse ? "danger" : undefined,
      secondary: `Su modelo ${stat(performance.modelMean)} · su historial ${stat(performance.historyMean)}`,
      href: "#rendimiento",
    })
  } else {
    items.push({ key: "rendimiento", label: `Rendimiento en ${links.periodLabel}`, value: "Sin cargas que cuenten", valueKind: "text", secondary: "Aún no hay un promedio para comparar", href: "#rendimiento" })
  }

  items.push({
    key: "litros",
    label: `Litros en ${links.periodLabel}`,
    value: `${formatQty(Math.round(loads.liters))} L`,
    secondary: `${formatQty(loads.count)} ${loads.count === 1 ? "carga" : "cargas"}`,
    href: "#cargas",
  })

  items.push(idle
    ? { key: "vacio", label: "Motor en vacío", value: idle.idlePct === null ? STAT_MISSING : `${formatQty(idle.idlePct, undefined, { maximumFractionDigits: 0 })} %`, valueKind: idle.idlePct === null ? "text" : "number", secondary: `${formatQty(idle.operatingHours, undefined, { maximumFractionDigits: 0 })} h de motor`, href: links.motorHref }
    : { key: "vacio", label: "Motor en vacío", value: "Sin telemetría", valueKind: "text", secondary: "No hay horas informadas en el período", href: links.motorHref })

  if (seals) {
    items.push({
      key: "sellos",
      label: "Cadena de sellos",
      value: seals.loads === 0 ? "Sin cargas con sello" : seals.mismatches === 0 ? "Cadena correcta" : "Cadena rota",
      valueKind: "text",
      secondary: seals.mismatches > 0 ? `${formatQty(seals.mismatches)} ${seals.mismatches === 1 ? "carga" : "cargas"} con el sello distinto al esperado` : undefined,
      href: links.sealsHref,
    })
  }
  return items
}

function Fact({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className={mono ? "font-mono tabular-nums" : undefined}>{value}</dd>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-mono font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** Las cifras que respaldan el gráfico: promedio del período, su modelo, su historial, y qué tan parejo es. */
function PerformanceFacts({ performance, periodLabel }: { performance: NonNullable<EquipmentFile["performance"]>; periodLabel: string }) {
  const unitLabel = PERFORMANCE_UNIT_LABELS[performance.unit]
  const row = (label: string, title: string, value: number | null, delta: number | null, worse: boolean) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-[var(--color-border)] py-1.5 last:border-b-0" title={title}>
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-mono tabular-nums">
        {value === null ? STAT_MISSING : `${stat(value)} ${unitLabel}`}
        {delta !== null ? <span className={worse ? "ml-3 font-semibold text-[var(--color-danger-ink)]" : "ml-3 text-[var(--color-text-muted)]"}>{signedPct(delta)}{worse ? " · rinde peor" : ""}</span> : null}
      </dd>
    </div>
  )
  return (
    <div>
      <dl className="text-sm">
        {row(`Promedio en ${periodLabel}`, `Promedio de sus ${performance.n} cargas válidas del período`, performance.mean, null, false)}
        {row("Su modelo", `Promedio de los demás equipos de la misma marca y modelo. Se avisa si empeora más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} %`, performance.modelMean, performance.deltaModelPct, performance.worseThanModel)}
        {row("Su historial (12 meses)", `Promedio de sus cargas válidas en los 12 meses anteriores al período. Se avisa si empeora más de ${WORSE_PERFORMANCE_THRESHOLD_PCT} %`, performance.historyMean, performance.deltaHistoryPct, performance.worseThanHistory)}
        <div className="flex flex-wrap items-center justify-between gap-x-4 py-1.5">
          <dt className="text-[var(--color-text-muted)]">Carga a carga</dt>
          <dd className="flex items-center gap-2"><RegularityBadge cv={performance.cv} /><span className="text-xs text-[var(--color-text-muted)]">{formatQty(performance.n)} {performance.n === 1 ? "carga válida" : "cargas válidas"}</span></dd>
        </div>
      </dl>
      {performance.excludedInReview > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {formatQty(performance.excludedInReview)} {performance.excludedInReview === 1 ? "carga por decidir no entra" : "cargas por decidir no entran"} a estos promedios; están en «Pendiente».
        </p>
      ) : null}
    </div>
  )
}
