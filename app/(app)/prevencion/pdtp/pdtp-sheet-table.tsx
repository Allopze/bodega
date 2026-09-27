"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { NotePencil } from "@phosphor-icons/react"
import {
  Table,
  TableBody,
  TableCell,
  TableCellNum,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/components/ui/table"
import { Pagination } from "@/components/ui/pagination"
import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpAggregateActivityWorksite, PdtpSheetView } from "@/lib/services/prevention-pdtp"
import { isPdtpActivityZeroThisMonth, pdtpActivationPeriod, pdtpPeriodFromChileDate, pdtpSheetActivityStatus, type PdtpActivityStatusFilter, type PdtpPeriod, type PdtpSheetActivityStatus } from "@/lib/services/pdtp/period"
import { PdtpExecutionForm } from "./pdtp-execution-form"
import { PdtpApprovalButtons } from "./pdtp-approval-buttons"
import { PdtpOverrideForm } from "./pdtp-override-form"
import { PdtpDeviationForm, PdtpDeviationList } from "./pdtp-deviation-form"
import { PdtpAssigneeChip, PdtpAssigneePicker } from "./pdtp-assignee-picker"
import { PdtpEvidenceThumbs } from "./pdtp-evidence-thumbs"
import {
  PdtpStatusBadge,
  PdtpExecutionStatusBadge,
  PdtpResponsibleChips,
  PdtpActivitySummary,
  PdtpDensityToggle,
  usePdtpDensity,
  PdtpPlanViewToggle,
  usePdtpPlanViewMode,
  type PdtpPlanViewMode,
  formatQuantity,
  usePdtpMonthWindow,
  type PdtpStatusCounts,
} from "./pdtp-sheet-table-ui"
import { pdtpDeviationKindLabel } from "@/lib/prevention/pdtp"
import { countOf, MONTH_LABELS } from "@/lib/utils"

/** Mes del período PDTP (1–12); etiqueta en `MONTH_LABELS[mes - 1]`. */
const PDTP_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

const EMPTY_PENDING_APPROVALS: PendingApproval[] = []

type PendingApproval = { id: string; activityId: string; month: number; week: number }

type ExecutionForBadges = { noCumpleCount: number; actionsPending: number; actionsOverdue: number }

/** Badges de checklist/plan de acción por ejecución (no_cumple, pendientes, vencidas). */
function PdtpExecutionBadges({ exec }: { exec: ExecutionForBadges }) {
  if (exec.noCumpleCount === 0 && exec.actionsPending === 0 && exec.actionsOverdue === 0) return null
  return (
    <>
      {exec.noCumpleCount > 0 && (
        <MetaBadge meta={{ label: `${exec.noCumpleCount} no cumple`, variant: "warning" }} />
      )}
      {exec.actionsOverdue > 0 && (
        <MetaBadge meta={{ label: `${exec.actionsOverdue} vencidas`, variant: "danger" }} />
      )}
      {exec.actionsPending > 0 && (
        <MetaBadge meta={{ label: `${exec.actionsPending} pendientes`, variant: "outline" }} />
      )}
    </>
  )
}

function PdtpAggregateBreakdown({ summaries, worksiteNames, planViewMode, bare = false }: { summaries: PdtpAggregateActivityWorksite[]; worksiteNames: Record<string, string>; planViewMode: PdtpPlanViewMode; bare?: boolean }) {
  if (summaries.length === 0) return null
  const chips = <div className="mt-1 flex flex-wrap gap-1.5">{summaries.map((summary) => {
    const planned = planViewMode === "historico" ? summary.historicalPlanned : summary.planned
    const executed = planViewMode === "historico" ? summary.historicalExecuted : summary.executed
    const statusLabel = summary.status === "executed" ? "Ejecutada" : summary.status === "overdue" ? "Atrasada" : summary.status === "pending" ? "Pendiente" : summary.status === "not_performed" ? "No realizada" : "No programada"
    return <MetaBadge key={summary.worksiteId} meta={{ label: `${worksiteNames[summary.worksiteId] ?? "Faena"}: Plan ${formatQuantity(planned)} · ejecutado ${formatQuantity(executed)} · Estado exigible: ${statusLabel}`, variant: "outline" }} />
  })}</div>
  // `bare`: sin <details> propio, para vivir dentro del expander único de la
  // vista anual (UI/UX 2026-08-05, B1b — antes había dos expanders por fila).
  if (bare) return chips
  return <details className="mt-2 text-[11px] text-[var(--color-text-muted)]"><summary className="cursor-pointer">Desglose por faena ({summaries.length})</summary>{chips}</details>
}

function aggregateSummaries(activity: PdtpSheetView["activities"][number]): PdtpAggregateActivityWorksite[] | null {
  return "worksiteSummaries" in activity ? activity.worksiteSummaries as PdtpAggregateActivityWorksite[] : null
}

/**
 * Agrupa actividades por objetivo, en el orden de `objectives` (ya viene
 * ordenado por `displayOrder` desde `listPdtpObjectives`). Un objetivo sin
 * actividades en esta vista no aparece: mostrar un grupo vacío no aporta. Las
 * actividades sin objetivo asignado quedan al final, en un grupo aparte.
 */
function groupActivitiesByObjective<A extends { objectiveId: string | null }>(
  activities: A[],
  objectives: ObjectiveSummary[],
): Array<{ label: string; activities: A[] }> {
  const byObjectiveId = new Map<string, A[]>()
  const unassigned: A[] = []
  for (const activity of activities) {
    if (activity.objectiveId) {
      const bucket = byObjectiveId.get(activity.objectiveId) ?? []
      bucket.push(activity)
      byObjectiveId.set(activity.objectiveId, bucket)
    } else {
      unassigned.push(activity)
    }
  }
  const groups = objectives
    .map((objective) => ({ label: `${objective.code} · ${objective.name}`, activities: byObjectiveId.get(objective.id) ?? [] }))
    .filter((group) => group.activities.length > 0)
  if (unassigned.length > 0) groups.push({ label: "Sin objetivo asignado", activities: unassigned })
  return groups
}

type SheetActivity = PdtpSheetView["activities"][number]
type SheetDeviation = SheetActivity["deviations"][number]

/**
 * Celda en la que abre "Registrar": la primera semana planificada del primer
 * mes vencido e impago (PREV-C06), o el período mirado si no hay atraso. La
 * deuda más antigua es la que se salda primero, y abrir en la semana de hoy
 * obligaba a buscarla a mano.
 */
function registerCellFor(activity: SheetActivity, status: PdtpSheetActivityStatus, currentPeriod: PdtpPeriod): { month: number; week: number } {
  if (status.status !== "overdue" || status.firstOverdueMonth === null) return { month: currentPeriod.month, week: currentPeriod.week }
  const weeks = activity.effectiveSchedule
    .filter((cell) => cell.month === status.firstOverdueMonth && cell.plannedQuantity > 0)
    .map((cell) => cell.week)
  return { month: status.firstOverdueMonth, week: weeks.length > 0 ? Math.min(...weeks) : 1 }
}

/**
 * Marca discreta en la celda de un mes cuando esa celda tiene desvíos
 * declarados. El `title` lista tipo, semana y motivo: sin él, una celda cuyo
 * P bajó por un "no aplica" o se movió por una reprogramación se lee como un
 * número que cambió solo.
 */
function PdtpDeviationMonthMark({ deviations }: { deviations: SheetDeviation[] }) {
  if (deviations.length === 0) return null
  const detail = deviations
    .map((deviation) => {
      const destino = deviation.targetMonth !== null && deviation.targetWeek !== null
        ? ` → ${MONTH_LABELS[deviation.targetMonth - 1]} sem ${deviation.targetWeek}`
        : ""
      // PREV-C07: un "No aplica" en revisión todavía no cambió el planificado.
      const enRevision = deviation.status === "pending_review" ? " (en revisión)" : ""
      return `${pdtpDeviationKindLabel(deviation.kind)}${enRevision} · sem ${deviation.week}${destino}: ${deviation.reason}`
    })
    .join("\n")
  return (
    <span
      className="ml-1 cursor-help align-super text-[9px] font-semibold text-[var(--color-signal-ink)]"
      title={detail}
      aria-label={`Desvíos declarados en el mes: ${deviations.length}`}
    >
      ✱
    </span>
  )
}

/** Desvíos de una actividad en un mes concreto. */
function deviationsForMonth(activity: SheetActivity, month: number): SheetDeviation[] {
  return activity.deviations.filter((deviation) => deviation.month === month)
}

/** Motivos declarados de "no realizada" para un mes, para el tooltip del badge. */
function notPerformedReasonsForMonth(activity: SheetActivity, month: number): string[] {
  return activity.deviations
    .filter((deviation) => deviation.kind === "not_performed" && deviation.month === month)
    .map((deviation) => deviation.reason)
}

type ObjectiveSummary = { id: string; code: string; name: string }

type PdtpSheetTableProps = {
  view: PdtpSheetView
  worksiteId?: string
  canExecute?: boolean
  canManageProgram?: boolean
  canApprove?: boolean
  pendingApprovals?: PendingApproval[]
  viewMode: "semana" | "anual"
  currentPeriod: PdtpPeriod
  sheetCode: string
  initialStatusFilter?: PdtpActivityStatusFilter | "all"
  aggregateWorksiteNames?: Record<string, string>
  /** Objetivos del programa, ordenados. Sin objetivos (la mayoría de los
   *  programas hoy), la tabla se comporta exactamente igual que antes: sin
   *  filtro ni agrupación. */
  objectives?: ObjectiveSummary[]
  /** Id de objetivo seleccionado por `?objetivo=` en el visor transversal. */
  objectiveFilter?: string
  /**
   * Fase 5 — asignación nominal vigente hoy en la faena seleccionada, por
   * actividad. Esta vista muestra TODAS las actividades (a diferencia de
   * Pendientes, que sólo muestra lo propio): el chip dice de quién es cada una.
   */
  assigneesByActivity?: Record<string, Array<{ userId: string; name: string }>>
  /** `prevention:pdtp:assignee:manage`: habilita el menú "Asignar a…". */
  canManageAssignees?: boolean
  /** Con `?asignado=yo`, el id del usuario por el que se filtra la tabla. */
  assigneeFilterUserId?: string
  /** Día chileno de hoy (`AAAA-MM-DD`), resuelto en el servidor. */
  today?: string
  /**
   * PREV-I03: actividades que esta persona puede registrar en la faena (las de
   * su cargo, las asignadas a ella). Sin la lista se ofrece todo —Prevención—.
   * Esconde el botón; la frontera real es el servidor.
   */
  registrableActivityIds?: readonly string[]
}

const EMPTY_OBJECTIVES: ObjectiveSummary[] = []
const EMPTY_ASSIGNEES_BY_ACTIVITY: Record<string, Array<{ userId: string; name: string }>> = {}
const EMPTY_ASSIGNEE_LIST: Array<{ userId: string; name: string }> = []

export function PdtpSheetTable({
  view,
  worksiteId,
  canExecute = false,
  canManageProgram = false,
  canApprove = false,
  pendingApprovals = EMPTY_PENDING_APPROVALS,
  viewMode,
  currentPeriod,
  sheetCode,
  initialStatusFilter = "all",
  aggregateWorksiteNames = {},
  objectives = EMPTY_OBJECTIVES,
  objectiveFilter,
  assigneesByActivity = EMPTY_ASSIGNEES_BY_ACTIVITY,
  canManageAssignees = false,
  assigneeFilterUserId,
  today = "",
  registrableActivityIds,
}: PdtpSheetTableProps) {
  const canOperate = canExecute || canManageProgram || canManageAssignees
  const registrable = React.useMemo(() => registrableActivityIds ? new Set(registrableActivityIds) : null, [registrableActivityIds])
  const canRegister = (activityId: string) => canExecute && (registrable === null || registrable.has(activityId))
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [statusFilter, setStatusFilter] = React.useState<PdtpActivityStatusFilter | "all">(initialStatusFilter)

  React.useEffect(() => setStatusFilter(initialStatusFilter), [initialStatusFilter])
  const [density, toggleDensity] = usePdtpDensity()
  const [planViewMode, setPlanViewMode] = usePdtpPlanViewMode()
  const [visibleMonths, monthsExpanded, toggleMonthsExpanded] = usePdtpMonthWindow(currentPeriod.month)
  const effectiveFrom = pdtpActivationPeriod(view.program.activatedAt)
  const aggregatePlanViewMode: PdtpPlanViewMode = viewMode === "anual" ? planViewMode : "exigible"
  const planViewDescription = planViewMode === "historico"
    ? "Plan / ejecutado incluye todas las semanas registradas aplicables a la faena; el estado sigue lo exigible desde la activación."
    : "Plan / ejecutado y estado consideran sólo las semanas exigibles desde la activación; las exclusiones por faena se respetan en ambos modos."

  // PREV-C06: la ÚNICA derivación de estado de la tabla. Conteos, filtro,
  // badge, filas de la vista semanal y la celda de "Registrar" pasan por acá;
  // el KPI "Atrasadas" del tablero usa la misma `pdtpSheetActivityStatus`.
  // "Hoy" viene del servidor (`today`) para no depender del reloj del navegador.
  const todayPeriod = pdtpPeriodFromChileDate(today) ?? currentPeriod
  const programYear = view.program.year ?? currentPeriod.year
  const statusCache = new Map<string, PdtpSheetActivityStatus>()
  const statusOf = (activity: SheetActivity): PdtpSheetActivityStatus => {
    const cached = statusCache.get(activity.id)
    if (cached) return cached
    const resolved = pdtpSheetActivityStatus(
      { ...activity, worksiteSummaries: aggregateSummaries(activity) ?? undefined },
      currentPeriod,
      { programYear, today: todayPeriod },
    )
    statusCache.set(activity.id, resolved)
    return resolved
  }

  const plannedQuantityForCurrentWeek = (activity: PdtpSheetView["activities"][number]) =>
    activity.effectiveSchedule
      .filter((cell) => cell.month === currentPeriod.month && cell.week === currentPeriod.week)
      .reduce((total, cell) => total + cell.plannedQuantity, 0)

  // El filtro por objetivo se aplica antes de derivar semana/anual: así el
  // conteo por estado, la paginación y el estado vacío de "sin actividades
  // esta semana" ya reflejan sólo el objetivo elegido.
  const objectiveFilteredActivities = objectiveFilter
    ? view.activities.filter((activity) => activity.objectiveId === objectiveFilter)
    : view.activities

  // `?asignado=yo`: la vista sigue pudiendo mostrarlo todo, pero deja verlo
  // acotado a lo propio sin tener que ir a Pendientes.
  const objectiveScopedActivities = assigneeFilterUserId
    ? objectiveFilteredActivities.filter((activity) =>
        (assigneesByActivity[activity.id] ?? EMPTY_ASSIGNEE_LIST).some((person) => person.userId === assigneeFilterUserId),
      )
    : objectiveFilteredActivities

  // D9: la vista semanal también muestra lo atrasado, aunque esta semana no
  // tenga plan. Es la vista de trabajo de la faena y el destino del KPI
  // "Atrasadas": sin esto el tile contaba filas que la lista no mostraba.
  const weeklyActivities = objectiveScopedActivities.filter(
    (activity) => plannedQuantityForCurrentWeek(activity) > 0 || statusOf(activity).status === "overdue",
  )

  // Derive status for all activities in the current view
  const viewActivities = viewMode === "semana" ? weeklyActivities : objectiveScopedActivities
  const sourceActivities = viewActivities

  const INITIAL_ROW_LIMIT = 30
  const [showAll, setShowAll] = React.useState(false)
  // W8: la vista semanal pagina de a 30. Antes cortaba en 30 sin botón ni
  // páginas (el "Mostrar las N" sólo existía en la anual), así que la
  // actividad 31 en adelante no se podía ver ni registrar. La página viaja en
  // `?page=` para que volver desde una ficha deje al usuario donde estaba.
  const requestedWeeklyPage = Number.parseInt(searchParams.get("page") ?? "1", 10)
  const [weeklyPage, setWeeklyPage] = React.useState(
    Number.isSafeInteger(requestedWeeklyPage) && requestedWeeklyPage > 1 ? requestedWeeklyPage : 1,
  )
  const weeklyTableRef = React.useRef<HTMLDivElement>(null)
  // Compute status counts for the summary
  const statusCounts: PdtpStatusCounts = (() => {
    const counts = { executed: 0, pending: 0, overdue: 0, not_scheduled: 0, not_performed: 0, zero: 0 }
    for (const activity of sourceActivities) {
      counts[statusOf(activity).status]++
      // `zero` se superpone a `pending`/`overdue` (ver el comentario de
      // `PdtpStatusCounts`): se recalcula aparte, no se deriva de `counts[s]`.
      // Usa `approvedMonthlyExecuted`, no `effectiveMonthlyExecuted`: el
      // indicador de cumplimiento (`compliance.ts`) solo cuenta ejecuciones
      // `approved`, así que una `submitted` sin aprobar no debe sacar a la
      // actividad de "en cero" aunque la tabla ya la muestre como ejecutada.
      if (isPdtpActivityZeroThisMonth(activity, activity.effectiveMonthlyPlanned, activity.approvedMonthlyExecuted, currentPeriod)) {
        counts.zero++
      }
    }
    return counts
  })()

  // Apply filter, then pagination for large tables. "en_cero" no es un
  // `PdtpActivityStatus` exacto: es `pending ∪ overdue` sin `coverage`/
  // `closed_on_time`, el mismo criterio que `zeroActivityIds` en
  // `compliance.ts` — de ahí que use su propio predicado en vez de comparar
  // contra `deriveActivityStatus(...) === statusFilter`, y que mire
  // `approvedMonthlyExecuted` (solo `approved`) en vez de
  // `effectiveMonthlyExecuted` (cualquier estado, lo que la tabla muestra).
  const filteredActivities = statusFilter === "all"
    ? sourceActivities
    : statusFilter === "en_cero"
      ? sourceActivities.filter((activity) =>
          isPdtpActivityZeroThisMonth(activity, activity.effectiveMonthlyPlanned, activity.approvedMonthlyExecuted, currentPeriod),
        )
      : sourceActivities.filter((activity) => statusOf(activity).status === statusFilter)

  // La paginación se mide sobre lo que realmente se ve: si el filtro de estado
  // deja pocas filas no hay nada que paginar, y el contador del botón tiene que
  // hablar de esas filas y no del total sin filtrar.
  const totalActivityCount = filteredActivities.length
  const needsPagination = viewMode === "anual" && totalActivityCount > INITIAL_ROW_LIMIT && !showAll
  const weeklyTotalPages = Math.max(1, Math.ceil(totalActivityCount / INITIAL_ROW_LIMIT))
  // Un `?page=` mayor que las páginas que quedan (p. ej. tras registrar y que
  // la lista se acorte) cae en la última en vez de mostrar una tabla vacía.
  const currentWeeklyPage = Math.min(weeklyPage, weeklyTotalPages)
  const displayActivities = viewMode === "semana"
    ? filteredActivities.slice((currentWeeklyPage - 1) * INITIAL_ROW_LIMIT, currentWeeklyPage * INITIAL_ROW_LIMIT)
    : needsPagination
      ? filteredActivities.slice(0, INITIAL_ROW_LIMIT)
      : filteredActivities

  const goToWeeklyPage = (next: number) => {
    setWeeklyPage(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next > 1) params.set("page", String(next))
    else params.delete("page")
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false })
    // La tabla tiene su propio scroll vertical (`stickyHeader`): sin esto la
    // página nueva se abría a la altura donde estaba el botón.
    weeklyTableRef.current?.scrollTo?.({ top: 0 })
  }

  // La agrupación por objetivo sólo aplica a la vista anual y sólo si el
  // programa declaró objetivos: fuera de eso, un único grupo "Actividades",
  // exactamente como se veía antes de que existieran los objetivos.
  const groupedActivities = viewMode === "anual" && objectives.length > 0
    ? groupActivitiesByObjective(displayActivities, objectives)
    : [{ label: "Actividades", activities: displayActivities }]

  const rowPy = density === "compact" ? "py-1.5" : "py-3"

  return (
    <div className="space-y-4">
      {/* Activity status summary + density toggle */}
      {sourceActivities.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PdtpActivitySummary
            counts={statusCounts}
            activeFilter={statusFilter}
            onFilter={(next) => {
              setStatusFilter(next)
              setWeeklyPage(1)
              const params = new URLSearchParams(searchParams.toString())
              if (next === "all") params.delete("estado")
              else params.set("estado", next)
              params.delete("page")
              router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false })
            }}
          />
          <PdtpDensityToggle density={density} onToggle={toggleDensity} />
          {viewMode === "anual" && (
            <>
              <PdtpPlanViewToggle mode={planViewMode} onChange={setPlanViewMode} />
              <button
                type="button"
                onClick={toggleMonthsExpanded}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                {monthsExpanded ? "Colapsar meses" : `Ver todos los meses (${visibleMonths.length}/12)`}
              </button>
            </>
          )}
        </div>
      )}

      {viewMode === "anual" && sourceActivities.length > 0 && (
        <p id="pdtp-plan-view-description" className="text-xs text-[var(--color-text-muted)]">
          {planViewDescription}
        </p>
      )}

      {viewMode === "semana" ? (
        weeklyActivities.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Sin actividades esta semana</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              No hay actividades planificadas para esta semana.
            </p>
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Sin resultados para este filtro</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Prueba seleccionando &ldquo;Todas&rdquo; para ver todas las actividades.
            </p>
          </div>
        ) : (
          <>
          <TableRoot ref={weeklyTableRef} stickyHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">N°</TableHead>
                  <TableHead className="min-w-[22rem]">Actividad</TableHead>
                  <TableHead className="min-w-[10rem]">Responsables</TableHead>
                  <TableHead>Estado</TableHead>
                  {canOperate && worksiteId && <TableHead className="w-48">Registrar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedActivities.map((group) => (
                  <React.Fragment key={group.label}>
                    {/* Section header row */}
                    <TableRow className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                      <TableCell
                        colSpan={canOperate && worksiteId ? 5 : 4}
                        className="py-1.5 pl-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]"
                      >
                        {group.label}
                      </TableCell>
                    </TableRow>
                    {group.activities.map((activity) => {
                      const resolvedStatus = statusOf(activity)
                      const { status, overdueMonths } = resolvedStatus
                      const registerCell = registerCellFor(activity, resolvedStatus, currentPeriod)
                      return (
                        <TableRow key={activity.id}>
                          <TableCell className={`font-mono text-xs text-[var(--color-text-faint)] ${rowPy}`}>
                            {activity.n}
                          </TableCell>
                          <TableCell className={rowPy}>
                            <div className="max-w-[36rem]">
                              <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                              {activity.notes && (
                                <p
                                  className="mt-1 flex items-start gap-1 text-[11px] italic text-[var(--color-text-faint)]"
                                  title={activity.notes}
                                >
                                  <NotePencil size={12} className="mt-0.5 shrink-0" aria-hidden />
                                  <span>{activity.notes.length > 100 ? `${activity.notes.slice(0, 100)}…` : activity.notes}</span>
                                </p>
                              )}
                              {!worksiteId && <PdtpAggregateBreakdown summaries={aggregateSummaries(activity) ?? []} planViewMode={aggregatePlanViewMode} worksiteNames={aggregateWorksiteNames} />}
                              {/* Los desvíos del mes viven bajo la actividad,
                                  no detrás de un ícono: explican por qué la
                                  celda de esta semana se ve como se ve. */}
                              {worksiteId && (
                                <PdtpDeviationList
                                  deviations={deviationsForMonth(activity, currentPeriod.month)}
                                  canWithdraw={canOperate}
                                />
                              )}
                              {worksiteId && activity.executions.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  {activity.executions.map((exec) => (
                                    <div key={exec.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
                                      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-subtle)]">
                                        <span className="font-mono">{MONTH_LABELS[exec.month - 1]} · Sem {exec.week}</span>
                                        <span>·</span>
                                        <span>{exec.executedQuantity}</span>
                                        <PdtpExecutionStatusBadge status={exec.status} />
                                      </div>
                                      <PdtpEvidenceThumbs
                                        evidenceUrl={exec.evidenceUrl}
                                        evidencePhotos={exec.evidencePhotos}
                                        evidenceText={exec.evidenceText}
                                      />
                                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        <Link
                                          href={`/prevencion/pdtp/${view.program.id}/ejecucion/${exec.id}`}
                                          className="text-[10px] font-medium text-[var(--color-primary)] hover:underline"
                                        >
                                          Ver verificación →
                                        </Link>
                                        <PdtpExecutionBadges exec={exec} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className={rowPy}>
                            <PdtpResponsibleChips display={activity.responsibleDisplay} />
                            <PdtpAssigneeChip names={(assigneesByActivity[activity.id] ?? EMPTY_ASSIGNEE_LIST).map((person) => person.name)} />
                          </TableCell>
                          <TableCell className={rowPy}>
                            <PdtpStatusBadge status={status} overdueMonths={overdueMonths} notPerformedReasons={notPerformedReasonsForMonth(activity, currentPeriod.month)} />
                          </TableCell>
                          {canOperate && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canRegister(activity.id) && <PdtpExecutionForm
                                  activityId={activity.id}
                                  activityN={activity.n}
                                  activityName={activity.activity}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={registerCell.month}
                                  defaultWeek={registerCell.week}
                                  effectiveFrom={effectiveFrom}
                                  evidenceRequirement={activity.evidenceRequirement}
                                  mechanism={activity.mechanism}
                                  manualEvidencePolicy={activity.manualEvidencePolicy}
                                />}
                                {canManageProgram && <PdtpOverrideForm
                                  programId={view.program.id}
                                  activityId={activity.id}
                                  activityN={activity.n}
                                  activityName={activity.activity}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={currentPeriod.month}
                                  defaultWeek={currentPeriod.week}
                                  globalQuantity={plannedQuantityForCurrentWeek(activity)}
                                  hoja={sheetCode}
                                />}
                                <PdtpDeviationForm
                                  activityId={activity.id}
                                  activityN={activity.n}
                                  activityName={activity.activity}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={currentPeriod.month}
                                  defaultWeek={currentPeriod.week}
                                  canDeclareNotPerformed={canExecute}
                                  canManagePlanning={canManageProgram}
                                />
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
          <Pagination
            page={currentWeeklyPage}
            total={totalActivityCount}
            perPage={INITIAL_ROW_LIMIT}
            onPage={goToWeeklyPage}
          />
          </>
        )
      ) : (
        filteredActivities.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Sin resultados para este filtro</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Prueba seleccionando &ldquo;Todas&rdquo; para ver todas las actividades.
            </p>
          </div>
        ) : (
          <>
            <p id="pdtp-horizontal-scroll-hint" className="mb-2 text-xs text-[var(--color-text-muted)] sm:hidden">
              Desliza horizontalmente para revisar más semanas y columnas.
            </p>
            <TableRoot stickyHeader aria-describedby="pdtp-horizontal-scroll-hint pdtp-plan-view-description">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-20 w-12 bg-[var(--color-surface-2)] shadow-[1px_0_0_var(--color-border)]">N°</TableHead>
                  {/* PREV-I01 (D29): bajo `md` sólo el N° queda fijo. Con N° + Actividad
                      fijos (48 + 352 px) la columna ocupaba todo el ancho de un
                      teléfono y tapaba "Registrar" por más que se deslizara. */}
                  <TableHead className="min-w-[22rem] md:sticky md:left-12 md:z-20 md:shadow-[1px_0_0_var(--color-border)]">Actividad</TableHead>
                  <TableHead>Estado</TableHead>
                  {visibleMonths.map((mi) => (
                    <TableHead
                      key={mi}
                      className="text-right"
                      title={`Plan / ejecutado · ${planViewMode === "historico" ? "histórico completo" : "exigible desde activación"}`}
                    >
                      {MONTH_LABELS[(PDTP_MONTHS[mi] ?? mi + 1) - 1]}
                    </TableHead>
                  ))}
                  <TableHead className="min-w-[7.5rem] text-right" title={planViewDescription}>
                    <span className="block">Plan / ejecutado</span>
                    <span className="block text-[10px] font-normal text-[var(--color-text-muted)]">{planViewMode === "historico" ? "Histórico" : "Exigible"}</span>
                  </TableHead>
                  {canOperate && worksiteId && <TableHead className="w-48">Registrar</TableHead>}
                  {canApprove && worksiteId && pendingApprovals.length > 0 && <TableHead className="min-w-[10rem]">Aprobar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedActivities.map((group) => (
                  <React.Fragment key={group.label}>
                    {/* Section header row */}
                    <TableRow className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                      <TableCell
                          colSpan={
                            3 + visibleMonths.length + 1
                            + (canOperate && worksiteId ? 1 : 0)
                            + (canApprove && worksiteId && pendingApprovals.length > 0 ? 1 : 0)
                          }
                        className="py-1.5 pl-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]"
                      >
                        {group.label}
                      </TableCell>
                    </TableRow>
                    {group.activities.map((activity) => {
                      const resolvedStatus = statusOf(activity)
                      const { status, overdueMonths } = resolvedStatus
                      const registerCell = registerCellFor(activity, resolvedStatus, currentPeriod)
                      // `group` + `group-hover` en las celdas sticky: su fondo
                      // sólido tapaba el hover de la fila y el gris se veía solo
                      // de ESTADO a la derecha — la "fila cortada" de la
                      // auditoría (UI/UX 2026-08-05, B1c).
                      return (
                        <TableRow key={activity.id} className="group">
                          <TableCell className={`sticky left-0 z-10 bg-[var(--color-surface)] group-hover:bg-[var(--color-surface-2)] font-mono text-xs text-[var(--color-text-faint)] shadow-[1px_0_0_var(--color-border)] ${rowPy}`}>
                            {activity.n}
                          </TableCell>
                          <TableCell className={`md:sticky md:left-12 md:z-10 md:bg-[var(--color-surface)] md:group-hover:bg-[var(--color-surface-2)] md:shadow-[1px_0_0_var(--color-border)] ${rowPy}`}>
                            <div className="max-w-[36rem]">
                              <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                              <details className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                <summary className="cursor-pointer hover:text-[var(--color-text)]">
                                  {worksiteId ? "Ver programa y responsables" : "Ver programa, responsables y faenas"}
                                </summary>
                                <div className="mt-1.5 space-y-1 border-l border-[var(--color-border)] pl-2">
                                  <p>{activity.program}</p>
                                  <PdtpResponsibleChips display={activity.responsibleDisplay} />
                                  <PdtpAssigneeChip names={(assigneesByActivity[activity.id] ?? EMPTY_ASSIGNEE_LIST).map((person) => person.name)} />
                                  {!worksiteId && <PdtpAggregateBreakdown bare summaries={aggregateSummaries(activity) ?? []} planViewMode={aggregatePlanViewMode} worksiteNames={aggregateWorksiteNames} />}
                                </div>
                              </details>
                              {worksiteId && activity.executions.length > 0 && (
                                <details className="mt-2 text-[11px]">
                                  <summary className="cursor-pointer text-[var(--color-text-muted)]">
                                    {countOf(activity.executions.length, "ejecución con evidencia", "ejecuciones con evidencia")}
                                  </summary>
                                  <div className="mt-1 space-y-2">
                                    {activity.executions.map((exec) => (
                                      <div key={exec.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
                                        <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-subtle)]">
                                          <span className="font-mono">{MONTH_LABELS[exec.month - 1]} · Sem {exec.week}</span>
                                          <span>·</span>
                                          <span>{exec.executedQuantity}</span>
                                          <PdtpExecutionStatusBadge status={exec.status} />
                                        </div>
                                        <PdtpEvidenceThumbs
                                          evidenceUrl={exec.evidenceUrl}
                                          evidencePhotos={exec.evidencePhotos}
                                          evidenceText={exec.evidenceText}
                                        />
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                          <Link
                                            href={`/prevencion/pdtp/${view.program.id}/ejecucion/${exec.id}`}
                                            className="text-[10px] font-medium text-[var(--color-primary)] hover:underline"
                                          >
                                            Ver verificación →
                                          </Link>
                                          <PdtpExecutionBadges exec={exec} />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className={rowPy}>
                            <PdtpStatusBadge status={status} overdueMonths={overdueMonths} notPerformedReasons={notPerformedReasonsForMonth(activity, currentPeriod.month)} />
                          </TableCell>
                          {visibleMonths.map((mi) => {
                            const planned = (planViewMode === "historico" ? activity.monthlyPlanned : activity.effectiveMonthlyPlanned)[mi] ?? 0
                            const executed = (planViewMode === "historico" ? activity.monthlyExecuted : activity.effectiveMonthlyExecuted)[mi] ?? 0
                            return (
                              <TableCellNum
                                key={mi}
                                className={[
                                  rowPy,
                                  planned > 0 ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
                                ].join(" ")}
                              >
                                <div className="whitespace-nowrap">
                                  <span>{formatQuantity(planned)}</span>
                                  <span className="text-[11px] text-[var(--color-success-ink)]"> / {formatQuantity(executed)}</span>
                                  <PdtpDeviationMonthMark deviations={deviationsForMonth(activity, (PDTP_MONTHS[mi] ?? mi + 1))} />
                                </div>
                              </TableCellNum>
                            )
                          })}
                          <TableCellNum className={`font-semibold whitespace-nowrap ${rowPy}`}>
                            {formatQuantity(planViewMode === "historico" ? activity.totalPlanned : activity.effectiveTotalPlanned)}<span className="text-[var(--color-success-ink)]"> / {formatQuantity(planViewMode === "historico" ? activity.totalExecuted : activity.effectiveTotalExecuted)}</span>
                            {/* PREV-C01: lo enviado sin revisar no es "ejecutado"; se muestra aparte. */}
                            {(activity.pendingTotalExecuted ?? 0) > 0 && (
                              <span className="block text-xs font-normal text-[var(--color-warning-ink)]">
                                +{formatQuantity(activity.pendingTotalExecuted ?? 0)} por aprobar
                              </span>
                            )}
                          </TableCellNum>
                          {canOperate && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canRegister(activity.id) && <PdtpExecutionForm
                                  activityId={activity.id}
                                  activityN={activity.n}
                                  activityName={activity.activity}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={registerCell.month}
                                  defaultWeek={registerCell.week}
                                  effectiveFrom={effectiveFrom}
                                  evidenceRequirement={activity.evidenceRequirement}
                                  mechanism={activity.mechanism}
                                  manualEvidencePolicy={activity.manualEvidencePolicy}
                                />}
                                {canManageProgram && <PdtpOverrideForm
                                  programId={view.program.id}
                                  activityId={activity.id}
                                  activityN={activity.n}
                                  activityName={activity.activity}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={currentPeriod.month}
                                  defaultWeek={currentPeriod.week}
                                  globalQuantity={(planViewMode === "historico" ? activity.monthlyPlanned : activity.effectiveMonthlyPlanned)[currentPeriod.month - 1] ?? 0}
                                  hoja={sheetCode}
                                />}
                                {/* Asignar es por faena: sin faena seleccionada
                                    no hay a quién nombrar, y la vista anual
                                    agregada no distingue de cuál se trata. */}
                                {canManageAssignees && <PdtpAssigneePicker
                                  activityId={activity.id}
                                  activityN={activity.n}
                                  activityName={activity.activity}
                                  worksiteId={worksiteId}
                                  currentAssignees={assigneesByActivity[activity.id] ?? EMPTY_ASSIGNEE_LIST}
                                  today={today}
                                />}
                              </div>
                            </TableCell>
                          )}
                          {canApprove && worksiteId && pendingApprovals.length > 0 && (
                            <TableCell className={rowPy}>
                              <PdtpApprovalButtons activityId={activity.id} pendingApprovals={pendingApprovals} />
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
          {needsPagination && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-2)]"
              >
                Mostrar las {totalActivityCount} actividades ({totalActivityCount - INITIAL_ROW_LIMIT} más)
              </button>
            </div>
          )}
          </>
        )
      )}
    </div>
  )
}
