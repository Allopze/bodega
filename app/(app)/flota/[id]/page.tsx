import type * as React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { EquipmentStateBadge } from "@/components/mantencion/jefatura/shared/equipment-state-badge"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExpiryStatus } from "@/components/ui/expiry-status"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { PERFORMANCE_UNIT_LABELS } from "@/lib/combustibles/control/contracts"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { logger } from "@/lib/logger"
import { dueText } from "@/lib/mantencion/format"
import { vehicleFichaHref, withSearchParams, type VehicleFichaArea } from "@/lib/routing/vehicle-ficha"
import {
  loadFichaDocuments,
  loadFichaFuel,
  loadFichaMaintenance,
  loadFichaState,
  type FichaDocumentsSummary,
  type FichaFuelSummary,
  type FichaMaintenanceSummary,
  type FichaStateSummary,
} from "@/lib/services/vehicle-ficha-summary"
import { formatDate, formatQty } from "@/lib/utils"
import { openVehicleFicha } from "./_ficha/access"
import { fuelPendingText, openOrdersText } from "./_ficha/summary-text"
import { vehicleFichaBreadcrumb, vehicleFichaDescription, VehicleFichaEditAction, VehicleFichaPersonalUseBadge, VehicleFichaOwnership, VehicleFichaTabs } from "./_ficha/ficha-chrome"
import { listPersonalUsePeriods } from "@/lib/services/fleet-personal-use"

export const metadata: Metadata = { title: "Vehículo" }

type SearchParams = Record<string, string | string[] | undefined>
type Loaded<T> = { ok: true; value: T } | { ok: false }

/** Una línea que no carga no tumba el Resumen: dice que no cargó y la pestaña sigue a un clic. */
async function attempt<T>(label: string, work: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work }
  } catch (error) {
    logger.error(`[ficha-vehiculo] resumen: ${label} falló`, error)
    return { ok: false }
  }
}

/**
 * «Resumen» de la ficha única del vehículo (crítica 2026-11-15, paso 4a): una línea por área
 * visible —estado, mantención, combustible y documentos—, cada una con su enlace a la pestaña
 * que la explica. Responde «¿cómo está?» sin abrir las tres áreas. Son frases, no tiles: cada
 * área ya tiene su tablero.
 *
 * Quien ve una sola área no tiene resumen: va directo a la suya.
 */
export default async function VehicleSummaryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params
  const sp = await searchParams
  const { session, ctx } = await openVehicleFicha(id)
  if (ctx.areas.length === 1) redirect(withSearchParams(vehicleFichaHref(id, ctx.areas[0]!), sp))
  // Insignia «En uso personal» de la cabecera: informativa, no tumba la página si falla.
  const personalUsePeriods = await listPersonalUsePeriods(id).catch(() => [])

  const has = (area: VehicleFichaArea) => ctx.areas.includes(area)
  const fuelPeriod = has("combustible") ? await resolveFuelPeriodForPage(session, sp) : null
  const [state, maintenance, fuel, documents] = await Promise.all([
    has("flota") ? attempt("estado", loadFichaState(ctx.vehicle)) : null,
    has("mantencion") ? attempt("mantención", loadFichaMaintenance(session, id, ctx.hasMaintenanceProfile)) : null,
    fuelPeriod ? attempt("combustible", loadFichaFuel(session, id, fuelPeriod)) : null,
    has("flota") ? attempt("documentos", loadFichaDocuments(id)) : null,
  ])

  const flotaHref = vehicleFichaHref(id, "flota")
  return (
    <PageContainer width="workbench">
      <PageHeader title={ctx.label} description={vehicleFichaDescription(ctx)} breadcrumb={vehicleFichaBreadcrumb(ctx, "resumen")} actions={<><VehicleFichaPersonalUseBadge periods={personalUsePeriods} /><VehicleFichaEditAction ctx={ctx} /></>} />
      <VehicleFichaOwnership vehicleId={ctx.vehicle.id} />
      <VehicleFichaTabs ctx={ctx} active="resumen" />

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-base">Cómo está {ctx.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-[var(--color-border)]">
            {state ? (
              <SummaryLine area="Estado" href={`${flotaHref}#historial-estado`} linkLabel="Ver historial">
                {state.ok ? <StateLine summary={state.value} /> : <Unavailable />}
              </SummaryLine>
            ) : null}
            {maintenance ? (
              <SummaryLine area="Mantención" href={vehicleFichaHref(id, "mantencion")} linkLabel="Ver Mantención">
                {maintenance.ok ? <MaintenanceLine summary={maintenance.value} /> : <Unavailable />}
              </SummaryLine>
            ) : null}
            {fuel && fuelPeriod ? (
              <SummaryLine area="Combustible" href={withSearchParams(vehicleFichaHref(id, "combustible"), sp)} linkLabel="Ver Combustible">
                {fuel.ok && fuel.value ? <FuelLine summary={fuel.value} period={fuelPeriod} /> : <Unavailable />}
              </SummaryLine>
            ) : null}
            {documents ? (
              <SummaryLine area="Documentos" href={`${flotaHref}#documentos`} linkLabel="Ver documentos">
                {documents.ok ? <DocumentsLine summary={documents.value} /> : <Unavailable />}
              </SummaryLine>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

/**
 * Una fila del resumen: el área, lo que dice y a dónde lleva. La fila entera es el enlace
 * (objetivo amplio, también en móvil); adentro sólo hay texto y etiquetas, nada interactivo.
 */
function SummaryLine({ area, href, linkLabel, children }: { area: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="group -mx-2 grid gap-x-6 gap-y-1.5 rounded-lg px-2 py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <span className="text-sm font-semibold text-[var(--color-text)]">{area}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-text)]">{children}</span>
        <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-[var(--color-primary-ink)] group-hover:underline group-hover:underline-offset-4">
          {linkLabel}
          <CaretRight size={14} weight="bold" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </Link>
    </li>
  )
}

function Unavailable() {
  return <span className="text-[var(--color-text-muted)]">No se pudo cargar. La pestaña tiene el detalle.</span>
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children}</span>
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function StateLine({ summary }: { summary: FichaStateSummary }) {
  return (
    <>
      <StateBadge entity="fleet" state={summary.status} />
      {summary.since ? <Muted>desde el {formatDate(summary.since)}</Muted> : null}
      {summary.reason && summary.status !== "operativo" ? <span>· {summary.reason}</span> : null}
    </>
  )
}

function MaintenanceLine({ summary }: { summary: FichaMaintenanceSummary }) {
  const orders = openOrdersText(summary.openOrders)
  if (!summary.inPlan || !summary.status || !summary.unit) {
    const open = summary.openOrders?.count ?? 0
    return (
      <>
        <span>No está en el plan de mantención.</span>
        {orders && open > 0 ? <Muted>Tiene {orders}.</Muted> : null}
      </>
    )
  }
  const { status, unit } = summary
  const due = status.state === "vencida" || status.state === "proxima" || status.state === "al_dia" ? dueText(status, unit) : null
  return (
    <>
      <EquipmentStateBadge state={status.state} workshop={summary.workshop ? { days: summary.workshop.daysStopped } : null} />
      {due ? <span>{due}</span> : null}
      {orders ? <Muted>{due ? "· " : ""}{capitalize(orders)}</Muted> : null}
    </>
  )
}

const performanceNumber = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 2 })
const rangeNumber = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

function FuelLine({ summary, period }: { summary: FichaFuelSummary; period: ResolvedFuelPeriod }) {
  const { vehicle, performance } = summary
  const pending = fuelPendingText(summary.pending)
  if (!vehicle.unit) {
    return <><span>No mide rendimiento.</span><Muted>{capitalize(pending)}.</Muted></>
  }
  const unit = PERFORMANCE_UNIT_LABELS[vehicle.unit]
  if (!performance || performance.mean === null) {
    return <><span>Sin cargas con rendimiento en {period.inLabel}.</span><Muted>{capitalize(pending)}.</Muted></>
  }
  const { mean, normalRange: range } = performance
  const position = range ? (mean < range.low ? "bajo" : mean > range.high ? "sobre" : "dentro de") : null
  // Peor = menos km/L o más L/h. La posición se dice con palabras; la etiqueta sólo aparece cuando rinde peor.
  const worse = range ? (vehicle.unit === "km_per_liter" ? mean < range.low : mean > range.high) : false
  return (
    <>
      {worse ? <MetaBadge meta={{ label: "Rinde peor que lo normal", variant: "warning" }} size="sm" /> : null}
      <span>
        {performanceNumber(mean)} {unit} en {period.inLabel}
        {range && position ? `, ${position} su rango normal (${rangeNumber(range.low)} a ${rangeNumber(range.high)})` : ""}
      </span>
      <Muted>· {pending}</Muted>
    </>
  )
}

function DocumentsLine({ summary }: { summary: FichaDocumentsSummary }) {
  if (!summary.next) return <Muted>Sin fechas de vencimiento registradas.</Muted>
  return <ExpiryStatus status={summary.next.status} subject={summary.next.documentType} warningDays={summary.warningDays} />
}
