import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { ExportLink } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import {
  listTrainingComplianceSlots,
  listTrainingOccurrencesPage,
  listTrainingOccurrenceWorksites,
  resolveTrainingOccurrenceYear,
} from "@/lib/services/prevention-training-occurrences"
import { resolveProgramActivationPeriods } from "@/lib/services/prevention-program-slots"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { buildSlotCalendar, parseCalendarMonth } from "@/lib/prevention/slot-compliance-calendar"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import { ProgramComplianceSection } from "@/components/prevention/program-compliance-section"
import { TrainingOccurrenceList } from "./training-occurrence-list"
import { trainingCatalogVersionForYear } from "@/lib/prevention/training-occurrences-catalog"
import { TRAINING_ALL_STATUS_PARAM, parseTrainingStatusParam, programVersionLabel } from "./training-view"
import { PdtpScheduledActivityPanelServer } from "@/components/prevention/pdtp-scheduled-activity-panel-server"

export const metadata: Metadata = { title: "Campañas y capacitación" }

const BASE_PATH = "/prevencion/capacitacion"
/** Tope de la búsqueda: más largo que cualquier código, título o nombre de faena. */
const MAX_SEARCH_LENGTH = 100
/** Una página fuera de rango se acota a la última, pero un número absurdo no llega a la base. */
const MAX_PAGE = 10_000

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function CapacitacionPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const canExport = can(session, "prevention:training:export")
  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const params = await searchParams
  // `?estado=` desconocido (`pendiente`, texto a mano): se normaliza a la vista por
  // omisión. Sin esto la lista mostraría «Pendientes» pero ninguna pestaña
  // quedaría activa, porque la pestaña compara el valor literal de la URL.
  const { status, known: knownStatus } = parseTrainingStatusParam(params?.estado)
  if (!knownStatus) {
    const normalized = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (key === "estado" || key === "page" || value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) normalized.append(key, item)
    }
    const query = normalized.toString()
    redirect(query ? `${BASE_PATH}?${query}` : BASE_PATH)
  }
  // PREV-C03.4/C03.7: el año pedido (?year o ?anio) si tiene catálogo; si no,
  // el año operativo del programa, que en enero puede seguir siendo el anterior.
  const year = await resolveTrainingOccurrenceYear(params?.year ?? params?.anio)
  const worksiteId = first(params?.faena)?.trim() ?? ""
  // `?mes=` es el mes que el usuario eligió en el calendario de cumplimiento.
  const month = parseCalendarMonth(params?.mes)
  const search = (first(params?.q) ?? "").trim().slice(0, MAX_SEARCH_LENGTH)
  const exportParams = new URLSearchParams({ year: String(year) })
  if (worksiteId) exportParams.set("faena", worksiteId)

  const [worksites, complianceSlots] = await Promise.all([
    listTrainingOccurrenceWorksites(access),
    // El calendario muestra todas las faenas del alcance aunque la lista esté
    // filtrada a una: por eso tiene su propia consulta. Además dice si el
    // programa tiene casillas en el alcance, que NO es lo mismo que «la página
    // de la lista salió vacía».
    listTrainingComplianceSlots(access, { year, includeWorksiteId: worksiteId || undefined }),
  ])
  const calendarWorksites = [...new Map(complianceSlots.map((slot) => [slot.worksiteId, { id: slot.worksiteId, label: slot.worksiteName }])).values()]
  const today = currentPdtpPeriod()
  // Desde cuándo exige el programa a CADA faena: el calendario lo usa para la
  // casilla «no exigible» y la lista para ordenar lo vencido y rotular lo que
  // aún no se exige. Un solo cálculo para los dos, así no pueden discrepar.
  const activationByRow = await resolveProgramActivationPeriods(calendarWorksites.map((row) => row.id), year)
  const activationByWorksite = Object.fromEntries(activationByRow)
  const calendar = buildSlotCalendar({
    year,
    today,
    rows: calendarWorksites,
    slots: complianceSlots.map((slot) => ({
      rowId: slot.worksiteId,
      month: slot.scheduledMonth,
      week: slot.scheduledWeek,
      status: slot.status,
    })),
    activationByRow,
  })

  // La lista se pagina y se filtra en la base (UX-01: antes pintaba las ~3.900
  // ocurrencias del año, 30 MB de HTML). Primero se pide la página que trae la
  // URL; si quedó fuera de rango (tras una acción la pestaña perdió filas), se
  // vuelve a pedir la última que existe.
  const pageQuery = {
    year,
    worksiteId: worksiteId || undefined,
    includeInactiveWorksites: Boolean(worksiteId),
    month,
    status,
    search: search || undefined,
    activationByWorksite,
    today,
    limit: DEFAULT_PAGE_SIZE,
  }
  const requestedPage = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(first(params?.page) ?? "1", 10) || 1))
  let result = await listTrainingOccurrencesPage(access, { ...pageQuery, offset: (requestedPage - 1) * DEFAULT_PAGE_SIZE })
  const pagination = resolvePagination({ pageParam: String(requestedPage), totalItems: result.total, pageSize: DEFAULT_PAGE_SIZE })
  if (pagination.page !== requestedPage) {
    result = await listTrainingOccurrencesPage(access, { ...pageQuery, offset: pagination.offset })
  }

  const viewHref = (view: { faena?: string; mes?: number | null; estado?: string }) => {
    const query = new URLSearchParams()
    if (view.faena) query.set("faena", view.faena)
    query.set("year", String(year))
    if (view.mes) query.set("mes", String(view.mes))
    if (view.estado) query.set("estado", view.estado)
    return `${BASE_PATH}?${query.toString()}`
  }
  // Quitar filtros conserva la faena y el año —el contexto en el que se trabaja—
  // y suelta mes, estado, texto y página.
  const clearHref = viewHref({ faena: worksiteId })

  return (
    <PageContainer>
      <PageHeader
        title="Campañas y capacitación"
        description="Control anual de campañas y capacitaciones por faena. Marca cada actividad como hecha o no hecha y conserva su evidencia."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Campañas y capacitación" },
        ]} />}
        actions={canExport ? <ExportLink href={`/api/prevencion/capacitacion/export?${exportParams.toString()}`} /> : undefined}
      />
      {/* Sin casillas el calendario no se dibuja ni explica nada: la lista de
        * abajo ya dice qué falta y ofrece la salida, y repetirlo sería ruido. */}
      <ProgramComplianceSection
        title={`Cumplimiento del programa ${year}`}
        caption={`Cumplimiento mensual de campañas y capacitaciones ${year}, por faena`}
        calendar={calendar}
        noun={{ singular: "faena", plural: "faenas" }}
        // El clic muestra TODO el mes: una celda verde que aterrizara en
        // «Pendientes» llevaría a una pestaña vacía, justo lo contrario de lo que
        // el color prometía.
        hrefFor={(rowId, cellMonth) => viewHref({ faena: rowId, mes: cellMonth, estado: TRAINING_ALL_STATUS_PARAM })}
        clearHref={clearHref}
        selected={worksiteId && month ? { rowId: worksiteId, month } : null}
        excel={canExport ? { permission: "prevention:training:export" } : undefined}
        className="mb-4"
      />
      <TrainingOccurrenceList
        rows={result.rows}
        counts={result.counts}
        status={status}
        search={search}
        worksites={worksites}
        selectedYear={year}
        selectedWorksiteId={worksiteId}
        selectedMonth={month}
        hasProgram={complianceSlots.length > 0}
        programLabel={programVersionLabel(year, trainingCatalogVersionForYear(year))}
        canRecord={session.user.permissions.includes("prevention:training:record")}
        activationByWorksite={activationByWorksite}
        clearFiltersHref={clearHref}
        showAllHref={viewHref({ faena: worksiteId, mes: month, estado: TRAINING_ALL_STATUS_PARAM })}
        // Se arma en el servidor: `hrefForPage` es una función y no cruza al
        // cliente. Los enlaces conservan los filtros y usan `scroll={false}`.
        pagination={
          <ServerPagination
            pagination={pagination}
            hrefForPage={(page) => buildPaginationHref(BASE_PATH, params ?? {}, page)}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs"
          />
        }
      />
      <PdtpScheduledActivityPanelServer connectorKey="training" />
    </PageContainer>
  )
}
