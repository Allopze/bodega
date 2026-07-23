"use client"

import * as React from "react"
import Link from "next/link"
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
import { Badge } from "@/components/ui/badge"
import type { PdtpSheetView } from "@/lib/services/prevention-pdtp"
import { deriveActivityStatus, countOverdueMonths, type PdtpActivityStatus, type PdtpPeriod } from "@/lib/services/pdtp/period"
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
  type PdtpStatusCounts,
} from "./pdtp-sheet-table-ui"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const EMPTY_PENDING_APPROVALS: PendingApproval[] = []

type PendingApproval = { id: string; activityId: string; month: number; week: number }

type ExecutionForBadges = { noCumpleCount: number; actionsPending: number; actionsOverdue: number }

/** Badges de checklist/plan de acción por ejecución (no_cumple, pendientes, vencidas). */
function PdtpExecutionBadges({ exec }: { exec: ExecutionForBadges }) {
  if (exec.noCumpleCount === 0 && exec.actionsPending === 0 && exec.actionsOverdue === 0) return null
  return (
    <>
      {exec.noCumpleCount > 0 && (
        <Badge variant="warning" size="sm">{exec.noCumpleCount} no cumple</Badge>
      )}
      {exec.actionsOverdue > 0 && (
        <Badge variant="danger" size="sm">{exec.actionsOverdue} vencidas</Badge>
      )}
      {exec.actionsPending > 0 && (
        <Badge variant="outline" size="sm">{exec.actionsPending} pendientes</Badge>
      )}
    </>
  )
}

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
  /** Objetivo (`objectiveOrder`) al que llega un KPI del reporte de gestión — el numerador/denominador visible coincide exactamente con esa fila. */
  objectiveOrder?: number
  programId?: string
}

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
  objectiveOrder,
  programId,
}: PdtpSheetTableProps) {
  const canOperate = canExecute || canManageProgram
  const [statusFilter, setStatusFilter] = React.useState<PdtpActivityStatus | "all">("all")
  const [density, toggleDensity] = usePdtpDensity()

  const plannedQuantityForCurrentWeek = (activity: PdtpSheetView["activities"][number]) =>
    activity.schedule
      .filter((cell) => cell.month === currentPeriod.month && cell.week === currentPeriod.week)
      .reduce((total, cell) => total + cell.plannedQuantity, 0)

  const weeklyActivities = view.activities.filter(
    (activity) => plannedQuantityForCurrentWeek(activity) > 0,
  )

  // Derive status for all activities in the current view
  const viewActivities = viewMode === "semana" ? weeklyActivities : view.activities
  // Un objetivo llegado por URL (KPI del reporte de gestión) acota todo lo
  // demas (contadores de estado, agrupacion) para que lo visible coincida
  // exactamente con el numerador/denominador de esa fila del reporte.
  const objectiveLabel = objectiveOrder !== undefined
    ? viewActivities.find((activity) => activity.objectiveOrder === objectiveOrder)?.objective ?? null
    : null
  const sourceActivities = objectiveOrder !== undefined
    ? viewActivities.filter((activity) => activity.objectiveOrder === objectiveOrder)
    : viewActivities
  // Reconstruido desde las props ya conocidas (mismo patron que PdtpViewToggle/
  // PdtpWorksitePicker en pdtp-sheet-table-ui.tsx), no leyendo el search params
  // ambiente: evita depender del contexto de App Router en este componente.
  const clearObjectiveHref = `${programId ? `/prevencion/pdtp/${programId}` : ""}?hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${viewMode}`

  // Compute status counts for the summary
  const statusCounts: PdtpStatusCounts = React.useMemo(() => {
    const counts = { executed: 0, pending: 0, overdue: 0, not_scheduled: 0 }
    for (const activity of sourceActivities) {
      const s = deriveActivityStatus(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
      counts[s]++
    }
    return counts
  }, [sourceActivities, currentPeriod])

  // Apply filter
  const filteredActivities = statusFilter === "all"
    ? sourceActivities
    : sourceActivities.filter((activity) =>
        deriveActivityStatus(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod) === statusFilter,
      )

  // Group by objective
  const groupedActivities = React.useMemo(() => {
    const groups: Array<{ objective: string; activities: typeof filteredActivities }> = []
    for (const activity of filteredActivities) {
      const last = groups[groups.length - 1]
      if (last && last.objective === activity.objective) {
        last.activities.push(activity)
      } else {
        groups.push({ objective: activity.objective, activities: [activity] })
      }
    }
    return groups
  }, [filteredActivities])

  const rowPy = density === "compact" ? "py-1.5" : "py-3"

  return (
    <div className="space-y-4">
      {objectiveOrder !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-sm text-[var(--color-info-ink)]">
          <span>Mostrando solo el objetivo {objectiveOrder}{objectiveLabel ? `: ${objectiveLabel}` : ""}.</span>
          <Link href={clearObjectiveHref} className="font-medium underline hover:no-underline">Quitar filtro</Link>
        </div>
      )}
      {/* Activity status summary + density toggle */}
      {sourceActivities.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PdtpActivitySummary
            counts={statusCounts}
            activeFilter={statusFilter}
            onFilter={setStatusFilter}
          />
          <PdtpDensityToggle density={density} onToggle={toggleDensity} />
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
          <TableRoot>
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
                  <React.Fragment key={group.objective}>
                    {/* Section header row */}
                    <TableRow className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                      <TableCell
                        colSpan={canOperate && worksiteId ? 5 : 4}
                        className="py-1.5 pl-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]"
                      >
                        {group.objective}
                      </TableCell>
                    </TableRow>
                    {group.activities.map((activity) => {
                      const status = deriveActivityStatus(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
                      const overdueMonths = countOverdueMonths(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
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
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-20 w-12 bg-[var(--color-surface-2)] shadow-[1px_0_0_var(--color-border)]">N°</TableHead>
                  <TableHead className="sticky left-12 z-20 min-w-[22rem] bg-[var(--color-surface-2)] shadow-[1px_0_0_var(--color-border)]">Actividad</TableHead>
                  <TableHead>Estado</TableHead>
                  {MONTH_LABELS.map((month) => (
                    <TableHead key={month} className="text-right">{month}</TableHead>
                  ))}
                  <TableHead className="min-w-[7.5rem] text-right">Plan / ejecutado</TableHead>
                  {canOperate && worksiteId && <TableHead className="w-48">Registrar</TableHead>}
                  {canApprove && worksiteId && pendingApprovals.length > 0 && <TableHead className="min-w-[10rem]">Aprobar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedActivities.map((group) => (
                  <React.Fragment key={group.objective}>
                    {/* Section header row */}
                    <TableRow className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                      <TableCell
                        colSpan={
                          3 + 12 + 1
                          + (canOperate && worksiteId ? 1 : 0)
                          + (canApprove && worksiteId && pendingApprovals.length > 0 ? 1 : 0)
                        }
                        className="py-1.5 pl-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]"
                      >
                        {group.objective}
                      </TableCell>
                    </TableRow>
                    {group.activities.map((activity) => {
                      const status = deriveActivityStatus(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
                      const overdueMonths = countOverdueMonths(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
                      return (
                        <TableRow key={activity.id}>
                          <TableCell className={`sticky left-0 z-10 bg-[var(--color-surface)] font-mono text-xs text-[var(--color-text-faint)] shadow-[1px_0_0_var(--color-border)] ${rowPy}`}>
                            {activity.n}
                          </TableCell>
                          <TableCell className={`sticky left-12 z-10 bg-[var(--color-surface)] shadow-[1px_0_0_var(--color-border)] ${rowPy}`}>
                            <div className="max-w-[36rem]">
                              <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                              <details className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                <summary className="cursor-pointer hover:text-[var(--color-text)]">Ver programa y responsables</summary>
                                <div className="mt-1.5 space-y-1 border-l border-[var(--color-border)] pl-2">
                                  <p>{activity.program}</p>
                                  <PdtpResponsibleChips display={activity.responsibleDisplay} />
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
                          {activity.monthlyPlanned.map((planned, index) => (
                            <TableCellNum
                              key={MONTH_LABELS[index]}
                              className={[
                                rowPy,
                                planned > 0 ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
                              ].join(" ")}
                            >
                              <div className="whitespace-nowrap">
                                <span>{formatQuantity(planned)}</span>
                                {worksiteId && (
                                  <span className="text-[11px] text-[var(--color-success)]"> / {formatQuantity(activity.monthlyExecuted[index] ?? 0)}</span>
                                )}
                              </div>
                            </TableCellNum>
                          ))}
                          <TableCellNum className={`font-semibold whitespace-nowrap ${rowPy}`}>
                            {formatQuantity(activity.totalPlanned)}{worksiteId && <span className="text-[var(--color-success)]"> / {formatQuantity(activity.totalExecuted)}</span>}
                          </TableCellNum>
                          {canOperate && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canExecute && <PdtpExecutionForm activityId={activity.id} worksiteId={worksiteId} year={view.program.year} />}
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
        )
      )}
    </div>
  )
}
