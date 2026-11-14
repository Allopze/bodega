import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { IndicatorFilters } from "@/components/dashboard/indicator-filters"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { DEFAULT_RANGE_LABEL, defaultIndicatorRange, resolveIndicatorPeriod } from "@/lib/indicators/period"
import { logger } from "@/lib/logger"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import {
  loadOpenWorkOrdersByStatus,
  loadOutOfService,
  loadPautaState,
  loadRecordIndicators,
  loadTopRepairEquipment,
  loadWorkOrderPeriodStats,
  loadWorkOrderSeries,
  type MantIndicatorQuery,
} from "@/lib/services/mantencion/indicators"
import { loadPanelWorksites } from "@/lib/services/mantencion/panel"
import { formatDate, todayInChile } from "@/lib/utils"
import { PautasSection, WorkOrdersSection } from "./indicators-sections"

export const metadata: Metadata = { title: "Indicadores de mantención" }
export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Indicadores de mantención: cómo nos fue en el período y hacia dónde va. El Panel sigue siendo la
 * bandeja de «qué falta hoy»; ésta contesta dos preguntas: ¿cómo avanza el trabajo de taller?
 * (órdenes de trabajo) y ¿cómo están las pautas y la disponibilidad de los equipos?
 *
 * Mismo gate que el Panel (`mant:records:view_*`). «Órdenes de trabajo» sólo se consulta y se
 * pinta con `mant:ot:view_*`: el costo de las OT va con esa misma capacidad (es la que el Panel
 * operacional usa para su columna «Mano de obra / taller (OT)»). Cada consulta degrada sola: si
 * una falla, su bloque no se pinta y el aviso de arriba lo dice, en vez de tumbar la página o
 * mostrar ceros que parecen datos.
 */
export default async function MantencionIndicatorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const params = await searchParams
  const today = todayInChile()
  const period = resolveIndicatorPeriod({ desde: params.desde, hasta: params.hasta }, today)
  const worksites = await loadPanelWorksites(viewer)
  // Una faena fuera del alcance (o inventada en la URL) se ignora: se mira todo lo visible.
  const requested = first(params.faena)
  const worksite = requested ? worksites.find((item) => item.id === requested) : undefined
  const worksiteId = worksite?.id ?? null

  const canViewOrders = can(session, "mant:ot:view_worksite") || can(session, "mant:ot:view_all")
  const canExport = can(session, "mant:export")

  const query: MantIndicatorQuery = {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    previous: period.previous,
    today,
    ...(worksiteId ? { worksiteId } : {}),
  }

  const degraded: string[] = []
  let tracked = 0
  function track<T>(promise: Promise<T>, label: string): Promise<T | null> {
    tracked++
    return promise.catch((error: unknown) => {
      logger.error(`[indicadores-mantencion] ${label} falló`, error)
      degraded.push(label)
      return null
    })
  }
  const none = <T,>(): Promise<T | null> => Promise.resolve(null)

  const [series, stats, byStatus, ranking, pautas, records, outOfService] = await Promise.all([
    canViewOrders ? track(loadWorkOrderSeries(viewer, query), "órdenes por período") : none<Awaited<ReturnType<typeof loadWorkOrderSeries>>>(),
    canViewOrders ? track(loadWorkOrderPeriodStats(viewer, query), "cifras de órdenes") : none<Awaited<ReturnType<typeof loadWorkOrderPeriodStats>>>(),
    canViewOrders ? track(loadOpenWorkOrdersByStatus(viewer, query.worksiteId), "órdenes abiertas por estado") : none<Awaited<ReturnType<typeof loadOpenWorkOrdersByStatus>>>(),
    canViewOrders ? track(loadTopRepairEquipment(viewer, query), "equipos con más reparaciones") : none<Awaited<ReturnType<typeof loadTopRepairEquipment>>>(),
    track(loadPautaState(viewer, query.worksiteId, today), "estado de las pautas"),
    track(loadRecordIndicators(viewer, query), "registros preventivos y correctivos"),
    track(loadOutOfService(viewer, query), "días fuera de servicio"),
  ])

  const scopeName = worksite?.name ?? (worksites.length === 1 ? worksites[0]!.name : "todas las faenas")
  const scopeNote = `${formatDate(period.from)} al ${formatDate(period.to)} · ${scopeName}`
  const common = {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    worksiteId,
    scopeNote,
    canExport,
  }

  return (
    <PageContainer>
      <PageHeader
        title="Indicadores de mantención"
        description="Cómo avanzan las órdenes de trabajo y cómo están las pautas y la disponibilidad de los equipos."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención", href: "/mantencion/panel" },
          { label: "Indicadores" },
        ]} />}
      />

      <div className="mb-4">
        <IndicatorFilters
          from={period.from}
          to={period.to}
          defaultRange={{ ...defaultIndicatorRange(today), label: DEFAULT_RANGE_LABEL }}
          worksites={worksites}
          worksiteId={worksiteId}
        />
      </div>

      {period.invalid && (
        <Callout tone="warning" className="mb-4">El rango de fechas de la dirección no es válido: se muestran {DEFAULT_RANGE_LABEL}.</Callout>
      )}
      <DegradedDataBanner degraded={degraded} total={tracked} />

      <div className="space-y-8">
        {canViewOrders && <WorkOrdersSection {...common} series={series} stats={stats} byStatus={byStatus} />}
        <PautasSection {...common} pautas={pautas} records={records} outOfService={outOfService} ranking={ranking} showRanking={canViewOrders} />
      </div>
    </PageContainer>
  )
}
