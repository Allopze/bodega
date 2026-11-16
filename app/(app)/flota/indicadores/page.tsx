import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PeriodControl } from "@/components/ui/period-control"
import { BoardExportButton } from "@/components/dashboard/board-export-button"
import { BoardHeaderActions } from "@/components/dashboard/board-scope"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { allWorksitesLabel } from "@/lib/auth/worksite-label"
import { chartWindowCaption, DEFAULT_RANGE_LABEL, defaultIndicatorRange, indicatorPeriodLabel, resolveIndicatorPeriod } from "@/lib/indicators/period"
import { logger } from "@/lib/logger"
import {
  getGpsDrivingIndicators,
  getGpsIdleIndicators,
  getGpsUsageIndicators,
  type GpsIndicatorsInput,
} from "@/lib/services/fleet-gps-indicators"
import { listVisibleWorksites } from "@/lib/services/prevention-indicadores"
import { rangeText } from "./gps-format"
import { DrivingSection, UsageSection, type GpsExcel } from "./gps-sections"

export const metadata: Metadata = { title: "Indicadores GPS" }

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Indicadores GPS: cómo se usó la flota en el período (km y horas de motor) y
 * cómo se condujo (motor en vacío, viajes, alertas). El Monitoreo GPS sigue siendo la
 * pantalla de «qué pasa ahora»; ésta contesta «cómo nos fue».
 *
 * Cada consulta degrada sola: si una falla, su bloque no se pinta y el aviso de
 * arriba lo dice, en vez de tumbar la página o mostrar ceros que parecen datos.
 * «Motor en vacío y conducción» es historial de recorridos y exige
 * `flota:view_gps_history`; su gráfico de motor en vacío, además, `combustibles:view`
 * (el permiso de la pantalla a la que remite).
 */
export default async function GpsIndicatorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const params = await searchParams
  const period = resolveIndicatorPeriod({ desde: params.desde, hasta: params.hasta })
  const worksites = await listVisibleWorksites(resolveWorksiteScope(session))
  // Una faena fuera del alcance (o inventada en la URL) se ignora: se mira todo lo visible.
  const requested = first(params.faena)
  const worksiteId = requested && worksites.some((worksite) => worksite.id === requested) ? requested : null

  const input: GpsIndicatorsInput = {
    from: period.from,
    to: period.to,
    previous: period.previous,
    granularity: period.granularity,
    // Los gráficos de evolución miran los seis meses que terminan en el período cuando éste es corto.
    chart: period.chart,
    ...(worksiteId ? { worksiteId } : {}),
  }
  const canViewHistory = can(session, "flota:view_gps_history")
  // Exportar es opt-in con el permiso de exportar de Flota: ver una cifra no da la descarga.
  const canExport = can(session, "flota:export")
  const allLabel = allWorksitesLabel(resolveWorksiteScope(session))
  const scopeName = worksites.find((worksite) => worksite.id === worksiteId)?.name ?? (worksites.length === 1 ? worksites[0]!.name : allLabel)
  const excel: GpsExcel | undefined = canExport
    ? {
        scope: { permission: "flota:export", notes: [`${rangeText(period)} · ${scopeName}`] },
        chart: { permission: "flota:export", notes: [`${chartWindowCaption(period.chart, rangeText)} · ${scopeName}`] },
      }
    : undefined
  const canViewIdle = canViewHistory && can(session, "combustibles:view")

  const degraded: string[] = []
  let tracked = 0
  function track<T>(promise: Promise<T>, label: string): Promise<T | null> {
    tracked++
    return promise.catch((error: unknown) => {
      logger.error(`[indicadores-gps] ${label} falló`, error)
      degraded.push(label)
      return null
    })
  }

  const [usage, idle, driving] = await Promise.all([
    track(getGpsUsageIndicators(session, input), "uso de la flota"),
    canViewIdle ? track(getGpsIdleIndicators(session, input), "el motor en vacío") : Promise.resolve(null),
    canViewHistory ? track(getGpsDrivingIndicators(session, input), "viajes y alertas") : Promise.resolve(null),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Indicadores GPS"
        description="Uso de la flota, motor en vacío y conducción en el período."
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Flota", href: "/flota" },
          { label: "Indicadores" },
        ]} />}
        // Esqueleto común de los tableros: faena y período primero, después «Exportar Excel» (todas las
        // tablas «Ver datos» de la pantalla, una hoja por gráfico), con `flota:export`.
        actions={
          <BoardHeaderActions
            worksites={worksites}
            worksiteId={worksiteId}
            allLabel={allLabel}
            period={<PeriodControl mode="range" from={period.requested.from} to={period.requested.to} defaultRange={{ ...defaultIndicatorRange(), label: DEFAULT_RANGE_LABEL }} />}
          >
            {canExport ? (
              <BoardExportButton title="Indicadores GPS" range={{ from: period.from, to: period.to }} scope={{ periodo: indicatorPeriodLabel(period.requested, rangeText), faena: scopeName }} />
            ) : null}
          </BoardHeaderActions>
        }
      />

      {period.invalid && (
        <Callout tone="warning" className="mb-4">El rango de fechas de la dirección no es válido: se muestra {DEFAULT_RANGE_LABEL}.</Callout>
      )}
      <DegradedDataBanner degraded={degraded} total={tracked} />

      <div className="space-y-8">
        {usage && <UsageSection usage={usage} period={period} excel={excel} />}
        {canViewHistory && (driving || (canViewIdle && idle)) && (
          <DrivingSection idle={idle} driving={driving} period={period} canViewIdle={canViewIdle} excel={excel} />
        )}
      </div>
    </PageContainer>
  )
}
