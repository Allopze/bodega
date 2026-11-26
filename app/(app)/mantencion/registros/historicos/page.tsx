import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { FormsResponsesView } from "./forms-responses-view"
import { HistoryExportButton } from "./history-export-button"
import { HistoryFilters } from "@/components/mantencion/historial/history-filters"
import { HistorySummary } from "@/components/mantencion/historial/history-summary"
import { HistoryTable } from "@/components/mantencion/historial/history-table"
import { WorkMatrixView } from "@/components/mantencion/historial/work-matrix"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { ServerPagination } from "@/components/ui/server-pagination"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { bucketLabel } from "@/lib/indicators/period"
import { ACTION_TYPE_LABELS, type ActionTypeOrUnknown } from "@/lib/mantencion/action-type"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { plural } from "@/lib/mantencion/format"
import {
  HISTORY_PAGE_SIZE, HISTORY_PATH, buildWorkMatrix, countByType, filterHistoryRows, historyHref, historyMonths, parseHistoryParams,
  sortHistoryRows, type HistoryParams,
} from "@/lib/mantencion/history-view"
import { resolvePagination } from "@/lib/pagination"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { resolveHistoricalWorksiteFilter, countHistoricalPending } from "@/lib/services/mantencion/historical-import"
import { loadHistoryWorksites } from "@/lib/services/mantencion/history-options"
import { loadMaintenanceHistory, summarizeMaintenanceWork } from "@/lib/services/mantencion/maintenance-work"
import { formatDate, todayInChile } from "@/lib/utils"

export const metadata: Metadata = { title: "Historial de mantenciones" }
export const dynamic = "force-dynamic"

type Raw = Record<string, string | string[] | undefined>

const TYPE_TABS: ReadonlyArray<{ type: ActionTypeOrUnknown; label: string }> = [
  { type: "correctiva", label: "Correctivas" },
  { type: "preventiva", label: "Preventivas" },
  { type: "predictiva", label: "Predictivas" },
  { type: "sin_clasificar", label: ACTION_TYPE_LABELS.sin_clasificar },
]

/**
 * En el teléfono estos selectores no caben en una fila. Sin esto cada opción partía su texto en dos líneas, el control no
 * bajaba de ~420 px y empujaba la página de lado. Ahora cada opción va en una línea y el control se desplaza dentro de
 * su caja. El anillo de foco va por dentro: el contenedor con desplazamiento lo recortaría por fuera.
 */
const SCROLLABLE_SEGMENTS = "max-w-full overflow-x-auto [&_a]:whitespace-nowrap focus-ring-inset"

function periodText(params: HistoryParams): string {
  if (params.period === "todo") return "de todo el historial"
  if (params.period === "12m") return "de los últimos 12 meses"
  return `del ${formatDate(params.from)} al ${formatDate(params.to)}`
}

export default async function MaintenanceHistoryPage({ searchParams }: { searchParams: Promise<Raw> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const raw = await searchParams
  const today = todayInChile()
  const params = parseHistoryParams(raw, today)
  const viewer = viewerFromSession(session)
  const canImport = can(session, "mant:equipment:manage") && can(session, "mant:records:view_all")
  const canExport = can(session, "mant:export")
  const pending = canImport ? await countHistoricalPending(viewer) : 0

  const viewItems = [
    { key: "historial", label: "Historial", active: params.view === "historial", href: historyHref(params, { view: "historial" }) },
    { key: "matriz", label: "Equipos por mes", active: params.view === "matriz", href: historyHref(params, { view: "matriz" }) },
    { key: "formularios", label: pending > 0 ? `Respuestas de formularios · ${pending} por completar` : "Respuestas de formularios", active: params.view === "formularios", href: historyHref(params, { view: "formularios" }) },
  ]

  const header = (
    <PageHeader
      title="Historial de mantenciones"
      description="Todo lo que se le hizo a los equipos: formularios anteriores, órdenes de trabajo y registros firmados."
      breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Historial de mantenciones" }]}
      actions={(
        <>
          {canExport && params.view !== "formularios" && <HistoryExportButton params={Object.fromEntries(new URL(historyHref(params, { page: 1 }), "http://localhost").searchParams)} />}
          {canImport && <Button asChild variant="secondary"><Link href={`${HISTORY_PATH}/importar`}>Importar respuestas de formularios</Link></Button>}
        </>
      )}
    />
  )
  const views = <SegmentedControl ariaLabel="Vista del historial" variant="segmented" items={viewItems} className={`mb-3 ${SCROLLABLE_SEGMENTS}`} />

  if (params.view === "formularios") {
    return (
      <PageContainer>
        {header}
        {views}
        <FormsResponsesView viewer={viewer} raw={raw} canImport={canImport} />
      </PageContainer>
    )
  }

  // Una faena fuera del alcance (o inventada en la URL) no se pasa al cargador: se trata como «sin filtro», igual que en el Panel.
  const worksite = await resolveHistoricalWorksiteFilter(viewer, params.worksiteId || undefined)
  const [worksites, loaded] = await Promise.all([
    loadHistoryWorksites(viewer),
    loadMaintenanceHistory(viewer, {
      from: params.from,
      to: params.to,
      ...(worksite ? { worksiteId: worksite.id } : {}),
      ...(params.vehicleId ? { vehicleId: params.vehicleId } : {}),
      today,
    }),
  ])
  const effective: HistoryParams = worksite || !params.worksiteId ? params : { ...params, worksiteId: "" }
  const filtered = filterHistoryRows(loaded.rows, effective)
  const typeCounts = countByType(filterHistoryRows(loaded.rows, effective, "type"))
  const allTypes = typeCounts.correctiva + typeCounts.preventiva + typeCounts.predictiva + typeCounts.sin_clasificar
  // Con agrupación, el orden lo manda el grupo (por equipo o por mes) y el sentido de las columnas no aplica.
  const ordered = effective.group === "equipo" ? sortHistoryRows(filtered, "equipo", "asc")
    : effective.group === "mes" ? sortHistoryRows(filtered, "fecha", "desc")
      : sortHistoryRows(filtered, effective.sort, effective.dir)
  const pagination = resolvePagination({ pageParam: String(effective.page), totalItems: ordered.length, pageSize: HISTORY_PAGE_SIZE })
  const pageRows = ordered.slice((pagination.page - 1) * HISTORY_PAGE_SIZE, pagination.page * HISTORY_PAGE_SIZE)
  const months = historyMonths(effective.from, effective.to)
  const vehicleLabel = effective.vehicleId ? loaded.rows.find((row) => row.vehicleId === effective.vehicleId)?.equipmentLabel : undefined
  const scopeNote = worksite?.name ?? (equipmentScope(viewer) === "all" ? "Todas las faenas" : "Tus faenas")
  // La matriz dibuja a lo más los últimos meses del período: si el período es más largo, se dice (la cabecera cuenta todo).
  const matrixWindowed = months[0]! > effective.from.slice(0, 7)

  const typeItems = [
    { key: "todos", label: `Todos (${allTypes})`, active: !effective.type, href: historyHref(effective, { type: null }) },
    ...TYPE_TABS.map(({ type, label }) => ({ key: type, label: `${label} (${typeCounts[type]})`, active: effective.type === type, href: historyHref(effective, { type }) })),
  ]
  const groupItems = [
    { key: "ninguno", label: "Sin agrupar", active: !effective.group, href: historyHref(effective, { group: null }) },
    { key: "equipo", label: "Por equipo", active: effective.group === "equipo", href: historyHref(effective, { group: "equipo" }) },
    { key: "mes", label: "Por mes", active: effective.group === "mes", href: historyHref(effective, { group: "mes" }) },
  ]

  const summary = filtered.length > 0
    ? summarizeMaintenanceWork(filtered, { from: effective.from, to: effective.to, chart: { from: `${months[0]}-01`, to: effective.to, granularity: "month" }, today })
    : null
  const hasFilters = Boolean(effective.q || effective.vehicleId || effective.worksiteId || effective.source || effective.type || effective.workshop || effective.specialty)

  return (
    <PageContainer>
      {header}
      {views}
      {params.periodInvalid && (
        <Callout tone="warning" className="mb-3" title="El rango de fechas no es válido">
          Se muestran los últimos 12 meses. Elige otro rango en los filtros.
        </Callout>
      )}
      <HistoryFilters
        worksites={worksites}
        state={{
          period: effective.period,
          from: effective.from,
          to: effective.to,
          ...(worksite ? { worksiteName: worksite.name } : {}),
          ...(vehicleLabel ? { vehicleLabel } : {}),
        }}
      />

      <div className="mb-3 text-sm text-[var(--color-text-muted)]">
        <p>{plural(ordered.length, "trabajo", "trabajos")} {periodText(effective)}{worksite ? ` en ${worksite.name}` : ""}.</p>
        <details className="mt-1 text-xs">
          <summary className="w-fit cursor-pointer text-[var(--color-primary-ink)] hover:underline">Qué cuenta</summary>
          <p className="mt-1 max-w-3xl">
            Los formularios hasta el {formatDate(FORMS_LAST_COUNTED_DATE)}, las órdenes de trabajo que entraron a taller y, desde el {formatDate(FORMS_CUTOVER_DATE)}, los registros firmados; sin anuladas ni pruebas.
            Las respuestas posteriores al corte y las posibles pruebas se ven en «Respuestas de formularios».
          </p>
        </details>
      </div>

      {summary && effective.view === "historial" && <HistorySummary summary={summary} params={effective} scopeNote={scopeNote} includesOrders={loaded.includesOrders} />}

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedControl ariaLabel="Filtrar por tipo de trabajo" variant="segmented" items={typeItems} className={SCROLLABLE_SEGMENTS} />
        {effective.view === "historial" && <SegmentedControl ariaLabel="Agrupar los trabajos" variant="segmented" items={groupItems} className={SCROLLABLE_SEGMENTS} />}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title="No hay trabajos para mostrar"
          description={hasFilters
            ? "Prueba con otra búsqueda o quita los filtros para ver todo el período."
            : effective.period === "12m"
              ? "No hay trabajos en los últimos 12 meses. Amplía el período para ver el historial completo."
              : "No hay trabajos en este período. Las respuestas de formularios se cargan en «Respuestas de formularios»."}
          action={hasFilters
            ? <Button asChild variant="secondary"><Link href={HISTORY_PATH}>Quitar los filtros</Link></Button>
            : effective.period !== "todo"
              ? <Button asChild variant="secondary"><Link href={historyHref(effective, { period: "todo" })}>Ver todo el historial</Link></Button>
              : undefined}
        />
      ) : effective.view === "matriz" ? (
        <>
          {matrixWindowed && (
            <p className="mb-2 text-xs text-[var(--color-text-muted)]">
              Se muestran los últimos {months.length} meses del período ({bucketLabel(months[0]!, "month")} a {bucketLabel(months[months.length - 1]!, "month")}). Para ver otros meses, elige un rango de fechas.
            </p>
          )}
          <WorkMatrixView matrix={buildWorkMatrix(filtered, months)} params={effective} />
        </>
      ) : (
        <>
          <HistoryTable rows={pageRows} params={effective} />
          <ServerPagination pagination={pagination} hrefForPage={(target) => historyHref(effective, { page: target })} />
        </>
      )}
    </PageContainer>
  )
}
