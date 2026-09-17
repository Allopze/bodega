import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getActivePdtpProgram,
  getPdtpAggregatedSheetViewByProgram,
  getPdtpSheetViewByProgram,
  listPdtpProgramWorksites,
  listPdtpProgramSheets,
  listPdtpPrograms,
  resolveProgramWorksiteIds,
  type PdtpAggregatedSheetView,
} from "@/lib/services/prevention-pdtp"
import { listScopedWorksites } from "@/lib/services/ppa"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import type { PdtpActivityStatus } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PdtpSheetTable } from "../pdtp-sheet-table"
import { PdtpPeriodPicker, PdtpProgramPicker, PdtpSheetPicker, PdtpViewToggle, PdtpWorksitePicker, PdtpYearPicker } from "../pdtp-sheet-table-ui"
import { buildPdtpActivitiesHref, resolvePdtpYear, resolveSelectedWorksiteId } from "../pdtp-context"
import { CreatePdtpRevisionButton } from "../[programId]/create-pdtp-revision-button"

export const metadata: Metadata = { title: "Actividades del programa preventivo" }

type ActivityViewerPageProps = {
  searchParams: Promise<{ programa?: string | string[]; hoja?: string | string[]; faena?: string | string[]; vista?: string | string[]; anio?: string | string[]; estado?: string | string[]; mes?: string | string[]; semana?: string | string[] }>
}

const VIEWER_HREF = "/prevencion/pdtp/actividades"
const one = (value?: string | string[]) => Array.isArray(value) ? value[0] : value

export default async function PdtpActivitiesPage({ searchParams }: ActivityViewerPageProps) {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const query = await searchParams
  const year = resolvePdtpYear(one(query.anio))
  const allPrograms = await listPdtpPrograms()
  const programs = allPrograms.filter((item) => item.year === year)
  const activeProgram = await getActivePdtpProgram(year)
  const program = programs.find((item) => item.id === one(query.programa))
    ?? activeProgram
    ?? (programs.length === 1 ? programs[0] : null)
  const canManageProgram = can(session, "prevention:pdtp:program:manage")

  const scope = resolveWorksiteScope(session)
  const scopedWorksites = await listScopedWorksites(scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [])
  const isGlobalViewer = session.user.roles.includes("prevencionista") || session.user.roles.includes("administrador")
  const requestedWorksite = one(query.faena)
  const viewMode: "semana" | "anual" = one(query.vista) === "semana"
    ? "semana"
    : one(query.vista) === "anual" || isGlobalViewer ? "anual" : "semana"
  const requestedStatus = one(query.estado)
  const statusFilter: PdtpActivityStatus | "all" = ["executed", "pending", "overdue", "not_scheduled"].includes(requestedStatus ?? "")
    ? requestedStatus as PdtpActivityStatus
    : "all"

  if (!program) {
    return (
      <PageContainer>
        <PageHeader title="Actividades del programa preventivo" description="Consulta y ejecuta las actividades asignadas por faena." breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Programa preventivo SG-SST (PDTP)", href: "/prevencion/pdtp" }, { label: "Actividades" }]} />} />
        <EmptyState title={`Sin programa preventivo para ${year}`} description="No hay actividades que consultar todavía." action={canManageProgram ? <Button asChild><Link href="/prevencion/pdtp/nuevo">Crear programa</Link></Button> : undefined} />
      </PageContainer>
    )
  }

  const programMembers = await listPdtpProgramWorksites(program.id)
  const effectiveWorksiteIds = new Set(resolveProgramWorksiteIds(
    programMembers.map((member) => member.worksiteId),
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [],
    scopedWorksites.map((worksite) => worksite.id),
    program.appliesToAllWorksites,
  ))
  const worksites = scopedWorksites.filter((worksite) => effectiveWorksiteIds.has(worksite.id))
  const hasUndeclaredActiveScope = program.status === "active"
    && !program.appliesToAllWorksites
    && programMembers.length === 0
  const hasNoAccessibleWorksites = worksites.length === 0 && !hasUndeclaredActiveScope
  const selectedWorksiteId = requestedWorksite
    ? resolveSelectedWorksiteId(requestedWorksite, worksites)
    : (!isGlobalViewer && worksites.length === 1 ? worksites[0]!.id : undefined)

  const sheetsRaw = await listPdtpProgramSheets(program.id)
  const sheets = [...new Map([...sheetsRaw].sort((a, b) => (a.programId ? 1 : -1) - (b.programId ? 1 : -1)).map((sheet) => [sheet.code, sheet] as const)).values()]
  const sheetCode = sheets.some((sheet) => sheet.code === one(query.hoja))
    ? one(query.hoja)!
    : sheets.find((sheet) => sheet.code === "pdtp_general")?.code ?? sheets[0]?.code ?? "pdtp_general"
  const basePeriod = currentPdtpPeriod()
  const requestedMonth = Number(one(query.mes))
  const requestedWeek = Number(one(query.semana))
  const currentPeriod = {
    ...basePeriod,
    month: Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12 ? requestedMonth : basePeriod.month,
    week: Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= 5 ? requestedWeek : basePeriod.week,
  }
  const requiresWorksiteSelection = !isGlobalViewer && !selectedWorksiteId && worksites.length > 1 && viewMode === "semana"
  const view = hasUndeclaredActiveScope || hasNoAccessibleWorksites || requiresWorksiteSelection
    ? null
    : selectedWorksiteId
      ? await getPdtpSheetViewByProgram(program.id, sheetCode, selectedWorksiteId)
      : await getPdtpAggregatedSheetViewByProgram(program.id, sheetCode, worksites.map((worksite) => worksite.id), currentPeriod)
  const aggregateView = view && "aggregate" in view ? view as PdtpAggregatedSheetView : null
  const selectedSheet = sheets.find((sheet) => sheet.code === sheetCode)
  const activityViewerHref = buildPdtpActivitiesHref({
    programa: program.id,
    hoja: sheetCode,
    faena: selectedWorksiteId,
    vista: viewMode,
    anio: String(year),
    estado: statusFilter,
    mes: currentPeriod.month,
    semana: currentPeriod.week,
  })
  const editProgramHref = `/prevencion/pdtp/${program.id}/editar?volver=${encodeURIComponent(activityViewerHref)}`
  const canRepairProgram = canManageProgram && program.status === "draft"

  const faenaChips = aggregateView?.worksiteSummaries.map((summary) => {
    const worksite = worksites.find((item) => item.id === summary.worksiteId)
    return <span key={summary.worksiteId} title={`${summary.planned} instancias exigibles y ${summary.executed} ejecutadas; histórico completo: ${summary.historicalPlanned} / ${summary.historicalExecuted} en ${worksite?.name ?? "la faena"}`} className="rounded-full border border-[var(--color-border)] px-2 py-1">{worksite?.name ?? "Faena"}: Plan {summary.planned} · ejecutado {summary.executed} <span className="text-[var(--color-text-faint)]">(exigible)</span></span>
  })

  return (
    <PageContainer>
      <PageHeader
        title="Actividades del programa preventivo"
        description={selectedWorksiteId ? "Trabajo programado, evidencia y avance de la faena seleccionada." : "Resumen anual agregado de todas las faenas autorizadas. Selecciona una faena para revisar evidencias y ejecutar."}
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Programa preventivo SG-SST (PDTP)", href: "/prevencion/pdtp" }, { label: "Actividades" }]} />}
        actions={<><Button asChild size="sm" variant="secondary"><Link href="/prevencion/pdtp/programas">Programas</Link></Button>{canManageProgram && <Button asChild size="sm"><Link href={`/prevencion/pdtp/${program.id}/editar`}>Gestionar programa</Link></Button>}</>}
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 border-y border-[var(--color-border)] py-3">
          <PdtpYearPicker current={year} years={allPrograms.map((item) => item.year)} hrefBase={VIEWER_HREF} sheetCode={sheetCode} worksiteId={selectedWorksiteId} viewMode={viewMode} status={statusFilter} month={currentPeriod.month} week={currentPeriod.week} />
          <PdtpPeriodPicker month={currentPeriod.month} week={currentPeriod.week} hrefBase={VIEWER_HREF} programId={program.id} sheetCode={sheetCode} worksiteId={selectedWorksiteId} viewMode={viewMode} year={year} status={statusFilter} />
          <PdtpProgramPicker current={program.id} programs={programs.map((item) => ({ id: item.id, title: item.title, year: item.year, version: item.version }))} hrefBase={VIEWER_HREF} sheetCode={sheetCode} worksiteId={selectedWorksiteId} viewMode={viewMode} year={year} status={statusFilter} month={currentPeriod.month} week={currentPeriod.week} />
          {sheets.length > 0 ? (
            <PdtpSheetPicker current={sheetCode} options={sheets.map((sheet) => ({ code: sheet.code, label: sheet.label }))} programId={program.id} worksiteId={selectedWorksiteId} viewMode={viewMode} hrefBase={VIEWER_HREF} year={year} status={statusFilter} month={currentPeriod.month} week={currentPeriod.week} />
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">Este programa aún no tiene hojas de actividades.</p>
          )}
          {worksites.length > 1 && <PdtpWorksitePicker current={selectedWorksiteId} sheetCode={sheetCode} worksites={worksites} programId={program.id} viewMode={viewMode} hrefBase={VIEWER_HREF} year={year} status={statusFilter} month={currentPeriod.month} week={currentPeriod.week} />}
          {/* Fila propia en móvil: con `ml-auto` a secas el toggle quedaba
              huérfano bajo los selects (UI/UX 2026-08-05, MV-3). */}
          <div className="w-full lg:ml-auto lg:w-auto"><PdtpViewToggle current={viewMode} sheetCode={sheetCode} worksiteId={selectedWorksiteId} programId={program.id} hrefBase={VIEWER_HREF} year={year} status={statusFilter} month={currentPeriod.month} week={currentPeriod.week} /></div>
        </div>

        {hasUndeclaredActiveScope ? (
          <EmptyState
            compact
            tone="warning"
            title="Alcance de faenas no declarado"
            description={canManageProgram
              ? "La versión activa no tiene faenas asignadas ni declara alcance corporativo. Crea una revisión v+1 para definir dónde se puede ejecutar."
              : "La versión activa no tiene faenas asignadas ni declara alcance corporativo. Solicita a quien administra el programa que cree una revisión v+1."}
            action={canManageProgram ? <CreatePdtpRevisionButton sourceProgramId={program.id} /> : undefined}
          />
        ) : hasNoAccessibleWorksites ? (
          <EmptyState
            compact
            tone="warning"
            title="Sin faenas accesibles para este programa"
            description="No tienes una faena de este programa dentro de tu alcance autorizado. Solicita la asignación correspondiente antes de consultar o registrar trabajo."
            action={<Button asChild size="sm" variant="secondary"><Link href={`/prevencion/pdtp/${program.id}`}>Revisar programa</Link></Button>}
          />
        ) : requiresWorksiteSelection ? <EmptyState compact title="Selecciona una faena para comenzar" description="Puedes consultar la vista anual, pero debes elegir una faena para revisar su evidencia o registrar ejecución." /> : !view ? <EmptyState compact tone="warning" title={sheets.length === 0 ? "Este programa aún no tiene una hoja de actividades" : `No se puede mostrar «${selectedSheet?.label ?? sheetCode}»`} description={sheets.length === 0 ? `Agrega una hoja y sus actividades a «${program.title}» para que la faena pueda registrar ejecución.` : `La hoja seleccionada no está disponible para «${program.title}». Revisa la configuración del programa y vuelve a esta misma vista.`} action={<Button asChild size="sm"><Link href={canRepairProgram ? editProgramHref : `/prevencion/pdtp/programas?anio=${year}`}>{canRepairProgram ? "Gestionar programa" : "Volver a programas"}</Link></Button>} /> : (
          <>
            {/* Móvil: los 9 chips eran ~4 filas antes del contenido; van tras un
                expander (UI/UX 2026-08-05, MV-2). En escritorio caben en una línea. */}
            {aggregateView && (
              <>
                <div className="hidden flex-wrap gap-2 text-xs text-[var(--color-text-muted)] lg:flex">{faenaChips}</div>
                <details className="text-xs text-[var(--color-text-muted)] lg:hidden">
                  <summary className="cursor-pointer font-medium">Ejecución por faena ({aggregateView.worksiteSummaries.length})</summary>
                  <div className="flex flex-wrap gap-2 pt-2">{faenaChips}</div>
                </details>
              </>
            )}
            <PdtpSheetTable view={view} worksiteId={selectedWorksiteId} canExecute={Boolean(selectedWorksiteId) && can(session, "prevention:pdtp:execute")} viewMode={viewMode} currentPeriod={currentPeriod} sheetCode={sheetCode} initialStatusFilter={statusFilter} aggregateWorksiteNames={Object.fromEntries(worksites.map((worksite) => [worksite.id, worksite.name]))} />
          </>
        )}
      </div>
    </PageContainer>
  )
}
