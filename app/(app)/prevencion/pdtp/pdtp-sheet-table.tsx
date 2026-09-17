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
import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpAggregateActivityWorksite, PdtpSheetView } from "@/lib/services/prevention-pdtp"
import { deriveActivityStatus, countOverdueMonths, isPdtpActivityZeroThisMonth, pdtpActivationPeriod, type PdtpActivityStatusFilter, type PdtpPeriod } from "@/lib/services/pdtp/period"
import { PdtpExecutionForm } from "./pdtp-execution-form"
import { PdtpApprovalButtons } from "./pdtp-approval-buttons"
import { PdtpOverrideForm } from "./pdtp-override-form"
import { PdtpEvidenceThumbs } from "./pdtp-evidence-thumbs"
import {
  PdtpStatusBadge,
  PdtpExecutionStatusBadge,
  PdtpResponsibleChips,
  PdtpActivitySummary,
  PdtpDensityToggle,
  usePdtpDensity,
  formatQuantity,
  usePdtpMonthWindow,
  type PdtpStatusCounts,
} from "./pdtp-sheet-table-ui"
import { MONTH_LABELS } from "@/lib/utils"

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

function PdtpAggregateBreakdown({ summaries, worksiteNames, bare = false }: { summaries: PdtpAggregateActivityWorksite[]; worksiteNames: Record<string, string>; bare?: boolean }) {
  if (summaries.length === 0) return null
  const chips = <div className="mt-1 flex flex-wrap gap-1.5">{summaries.map((summary) => <MetaBadge key={summary.worksiteId} meta={{ label: `${worksiteNames[summary.worksiteId] ?? "Faena"}: Plan ${summary.planned} · ejecutado ${summary.executed} · ${summary.status === "executed" ? "Ejecutada" : summary.status === "overdue" ? "Atrasada" : summary.status === "pending" ? "Pendiente" : "No programada"}`, variant: "outline" }} />)}</div>
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
}

const EMPTY_OBJECTIVES: ObjectiveSummary[] = []

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
}: PdtpSheetTableProps) {
  const canOperate = canExecute || canManageProgram
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [statusFilter, setStatusFilter] = React.useState<PdtpActivityStatusFilter | "all">(initialStatusFilter)

  React.useEffect(() => setStatusFilter(initialStatusFilter), [initialStatusFilter])
  const [density, toggleDensity] = usePdtpDensity()
  const [visibleMonths, monthsExpanded, toggleMonthsExpanded] = usePdtpMonthWindow(currentPeriod.month)
  const effectiveFrom = pdtpActivationPeriod(view.program.activatedAt)

  const plannedQuantityForCurrentWeek = (activity: PdtpSheetView["activities"][number]) =>
    activity.effectiveSchedule
      .filter((cell) => cell.month === currentPeriod.month && cell.week === currentPeriod.week)
      .reduce((total, cell) => total + cell.plannedQuantity, 0)

  // El filtro por objetivo se aplica antes de derivar semana/anual: así el
  // conteo por estado, la paginación y el estado vacío de "sin actividades
  // esta semana" ya reflejan sólo el objetivo elegido.
  const objectiveScopedActivities = objectiveFilter
    ? view.activities.filter((activity) => activity.objectiveId === objectiveFilter)
    : view.activities

  const weeklyActivities = objectiveScopedActivities.filter(
    (activity) => plannedQuantityForCurrentWeek(activity) > 0,
  )

  // Derive status for all activities in the current view
  const viewActivities = viewMode === "semana" ? weeklyActivities : objectiveScopedActivities
  const sourceActivities = viewActivities

  const INITIAL_ROW_LIMIT = 30
  const [showAll, setShowAll] = React.useState(false)
  // Compute status counts for the summary
  const statusCounts: PdtpStatusCounts = React.useMemo(() => {
    const counts = { executed: 0, pending: 0, overdue: 0, not_scheduled: 0, zero: 0 }
    for (const activity of sourceActivities) {
      const s = deriveActivityStatus(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, currentPeriod)
      counts[s]++
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
  }, [sourceActivities, currentPeriod])

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
      : sourceActivities.filter((activity) =>
          deriveActivityStatus(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, currentPeriod) === statusFilter,
        )

  // La paginación se mide sobre lo que realmente se ve: si el filtro de estado
  // deja pocas filas no hay nada que paginar, y el contador del botón tiene que
  // hablar de esas filas y no del total sin filtrar.
  const totalActivityCount = filteredActivities.length
  const needsPagination = totalActivityCount > INITIAL_ROW_LIMIT && !showAll
  const displayActivities = needsPagination
    ? filteredActivities.slice(0, INITIAL_ROW_LIMIT)
    : filteredActivities

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
              const params = new URLSearchParams(searchParams.toString())
              if (next === "all") params.delete("estado")
              else params.set("estado", next)
              router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false })
            }}
          />
          <PdtpDensityToggle density={density} onToggle={toggleDensity} />
          {viewMode === "anual" && (
            <button
              type="button"
              onClick={toggleMonthsExpanded}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              {monthsExpanded ? "Colapsar meses" : `Ver todos los meses (${visibleMonths.length}/12)`}
            </button>
          )}
        </div>
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
          <TableRoot stickyHeader>
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
                      const status = deriveActivityStatus(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, currentPeriod)
                      const overdueMonths = countOverdueMonths(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, currentPeriod)
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
                              {!worksiteId && <PdtpAggregateBreakdown summaries={aggregateSummaries(activity) ?? []} worksiteNames={aggregateWorksiteNames} />}
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
                          </TableCell>
                          <TableCell className={rowPy}>
                            <PdtpStatusBadge status={status} overdueMonths={overdueMonths} />
                          </TableCell>
                          {canOperate && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canExecute && <PdtpExecutionForm
                                  activityId={activity.id}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={currentPeriod.month}
                                  defaultWeek={currentPeriod.week}
                                  effectiveFrom={effectiveFrom}
                                  evidenceRequirement={activity.evidenceRequirement}
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
            <TableRoot stickyHeader aria-describedby="pdtp-horizontal-scroll-hint">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-20 w-12 bg-[var(--color-surface-2)] shadow-[1px_0_0_var(--color-border)]">N°</TableHead>
                  <TableHead className="sticky left-12 z-20 min-w-[22rem] bg-[var(--color-surface-2)] shadow-[1px_0_0_var(--color-border)]">Actividad</TableHead>
                  <TableHead>Estado</TableHead>
                  {visibleMonths.map((mi) => (
                    <TableHead key={mi} className="text-right">{MONTH_LABELS[(PDTP_MONTHS[mi] ?? mi + 1) - 1]}</TableHead>
                  ))}
                  <TableHead className="min-w-[7.5rem] text-right">Plan / ejecutado</TableHead>
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
                      const status = deriveActivityStatus(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, currentPeriod)
                      const overdueMonths = countOverdueMonths(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, currentPeriod)
                      // `group` + `group-hover` en las celdas sticky: su fondo
                      // sólido tapaba el hover de la fila y el gris se veía solo
                      // de ESTADO a la derecha — la "fila cortada" de la
                      // auditoría (UI/UX 2026-08-05, B1c).
                      return (
                        <TableRow key={activity.id} className="group">
                          <TableCell className={`sticky left-0 z-10 bg-[var(--color-surface)] group-hover:bg-[var(--color-surface-2)] font-mono text-xs text-[var(--color-text-faint)] shadow-[1px_0_0_var(--color-border)] ${rowPy}`}>
                            {activity.n}
                          </TableCell>
                          <TableCell className={`sticky left-12 z-10 bg-[var(--color-surface)] group-hover:bg-[var(--color-surface-2)] shadow-[1px_0_0_var(--color-border)] ${rowPy}`}>
                            <div className="max-w-[36rem]">
                              <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                              <details className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                <summary className="cursor-pointer hover:text-[var(--color-text)]">
                                  {worksiteId ? "Ver programa y responsables" : "Ver programa, responsables y faenas"}
                                </summary>
                                <div className="mt-1.5 space-y-1 border-l border-[var(--color-border)] pl-2">
                                  <p>{activity.program}</p>
                                  <PdtpResponsibleChips display={activity.responsibleDisplay} />
                                  {!worksiteId && <PdtpAggregateBreakdown bare summaries={aggregateSummaries(activity) ?? []} worksiteNames={aggregateWorksiteNames} />}
                                </div>
                              </details>
                              {worksiteId && activity.executions.length > 0 && (
                                <details className="mt-2 text-[11px]">
                                  <summary className="cursor-pointer text-[var(--color-text-muted)]">
                                    {activity.executions.length} ejecución(es) con evidencia
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
                            <PdtpStatusBadge status={status} overdueMonths={overdueMonths} />
                          </TableCell>
                          {visibleMonths.map((mi) => {
                            const planned = activity.monthlyPlanned[mi] ?? 0
                            const executed = activity.monthlyExecuted[mi] ?? 0
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
                                  <span className="text-[11px] text-[var(--color-success)]"> / {formatQuantity(executed)}</span>
                                </div>
                              </TableCellNum>
                            )
                          })}
                          <TableCellNum className={`font-semibold whitespace-nowrap ${rowPy}`}>
                            {formatQuantity(activity.totalPlanned)}<span className="text-[var(--color-success)]"> / {formatQuantity(activity.totalExecuted)}</span>
                          </TableCellNum>
                          {canOperate && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canExecute && <PdtpExecutionForm
                                  activityId={activity.id}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={currentPeriod.month}
                                  defaultWeek={currentPeriod.week}
                                  effectiveFrom={effectiveFrom}
                                  evidenceRequirement={activity.evidenceRequirement}
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
                                  globalQuantity={activity.monthlyPlanned[currentPeriod.month - 1] ?? 0}
                                  hoja={sheetCode}
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
