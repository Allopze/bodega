"use client"

import * as React from "react"
import Link from "next/link"
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
  PdtpMetric,
  PdtpProgressRing,
  PdtpResponsibleChips,
  PdtpActivitySummary,
  PdtpDensityToggle,
  usePdtpDensity,
  formatQuantity,
  type PdtpStatusCounts,
} from "./pdtp-sheet-table-ui"
import { ListChecks, CalendarDots, CheckSquare, ChartBar } from "@phosphor-icons/react"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

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
  canManage?: boolean
  canApprove?: boolean
  pendingApprovals?: PendingApproval[]
  viewMode: "semana" | "anual"
  currentPeriod: PdtpPeriod
  sheetCode: string
}

export function PdtpSheetTable({
  view,
  worksiteId,
  canManage = false,
  canApprove = false,
  pendingApprovals = [],
  viewMode,
  currentPeriod,
  sheetCode,
}: PdtpSheetTableProps) {
  const annualPlanned = view.monthlyTotals.reduce((sum, month) => sum + month.planned, 0)
  const annualExecuted = view.monthlyTotals.reduce((sum, month) => sum + month.executed, 0)
  const annualPercent = annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) : null

  const [statusFilter, setStatusFilter] = React.useState<PdtpActivityStatus | "all">("all")
  const [density, toggleDensity] = usePdtpDensity()

  const weeklyActivities = view.activities.filter(
    (activity) => (activity.monthlyPlanned[currentPeriod.month - 1] ?? 0) > 0,
  )

  // Derive status for all activities in the current view
  const sourceActivities = viewMode === "semana" ? weeklyActivities : view.activities

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

  // Compliance variant
  const complianceVariant =
    annualPercent === null ? "neutral"
    : annualPercent >= 80 ? "success"
    : annualPercent >= 50 ? "warning"
    : "danger"

  // Period label for subtitle
  const monthName = MONTH_LABELS[currentPeriod.month - 1]
  const periodLabel = `${monthName} ${currentPeriod.year} · S${currentPeriod.week}`

  const rowPy = density === "compact" ? "py-1.5" : "py-3"

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PdtpMetric
          label="Actividades"
          value={view.activities.length}
          subtitle={`en ${viewMode === "semana" ? "esta semana" : "el programa"}`}
          icon={<ListChecks size={13} />}
          variant="neutral"
        />
        <PdtpMetric
          label="Plan anual"
          value={formatQuantity(annualPlanned)}
          subtitle="ejecuciones planificadas"
          icon={<CalendarDots size={13} />}
          variant="neutral"
        />
        <PdtpMetric
          label="Ejecutado"
          value={worksiteId ? formatQuantity(annualExecuted) : "-"}
          subtitle={worksiteId ? periodLabel : "Selecciona una faena"}
          icon={<CheckSquare size={13} />}
          variant={worksiteId ? "neutral" : "danger"}
        />
        <PdtpMetric
          label="Cumplimiento"
          value={annualPercent === null ? "-" : `${annualPercent}%`}
          subtitle={`Meta: ${view.program.complianceTarget ? `${Math.round(Number(view.program.complianceTarget) * 100)}%` : "—"}`}
          icon={<ChartBar size={13} />}
          variant={complianceVariant}
          ring={
            <PdtpProgressRing percent={annualPercent} size={52} />
          }
        />
      </div>

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
              No hay actividades planificadas para este mes.
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
                  {canManage && worksiteId && <TableHead className="w-48">Registrar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedActivities.map((group) => (
                  <React.Fragment key={group.objective}>
                    {/* Section header row */}
                    <TableRow className="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                      <TableCell
                        colSpan={canManage && worksiteId ? 5 : 4}
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
                                  className="mt-1 text-[11px] italic text-[var(--color-text-faint)]"
                                  title={activity.notes}
                                >
                                  📝 {activity.notes.length > 100 ? `${activity.notes.slice(0, 100)}…` : activity.notes}
                                </p>
                              )}
                              {worksiteId && activity.executions.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  {activity.executions.map((exec) => (
                                    <div key={exec.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
                                      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-subtle)]">
                                        <span className="font-mono">M{exec.month}/S{exec.week}</span>
                                        <span>·</span>
                                        <span>{exec.executedQuantity}</span>
                                        <span>·</span>
                                        <span className="uppercase tracking-wide">{exec.status}</span>
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
                          {canManage && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <PdtpExecutionForm
                                  activityId={activity.id}
                                  worksiteId={worksiteId}
                                  year={view.program.year}
                                  defaultMonth={currentPeriod.month}
                                  defaultWeek={currentPeriod.week}
                                />
                                <PdtpOverrideForm
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
                  <TableHead className="w-12">N°</TableHead>
                  <TableHead className="min-w-[22rem]">Actividad</TableHead>
                  <TableHead className="min-w-[12rem]">Programa</TableHead>
                  <TableHead className="min-w-[10rem]">Responsables</TableHead>
                  <TableHead>Estado</TableHead>
                  {MONTH_LABELS.map((month) => (
                    <TableHead key={month} className="text-right">{month}</TableHead>
                  ))}
                  <TableHead className="text-right">Plan</TableHead>
                  <TableHead className="text-right">Ejecutado</TableHead>
                  {canManage && worksiteId && <TableHead className="w-48">Registrar</TableHead>}
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
                          5 + 12 + 2
                          + (canManage && worksiteId ? 1 : 0)
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
                          <TableCell className={`font-mono text-xs text-[var(--color-text-faint)] ${rowPy}`}>
                            {activity.n}
                          </TableCell>
                          <TableCell className={rowPy}>
                            <div className="max-w-[36rem]">
                              <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                              {worksiteId && activity.executions.length > 0 && (
                                <details className="mt-2 text-[11px]">
                                  <summary className="cursor-pointer text-[var(--color-text-muted)]">
                                    {activity.executions.length} ejecución(es) con evidencia
                                  </summary>
                                  <div className="mt-1 space-y-2">
                                    {activity.executions.map((exec) => (
                                      <div key={exec.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
                                        <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-subtle)]">
                                          <span className="font-mono">M{exec.month}/S{exec.week}</span>
                                          <span>·</span>
                                          <span>{exec.executedQuantity}</span>
                                          <span>·</span>
                                          <span className="uppercase tracking-wide">{exec.status}</span>
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
                          <TableCell className={`text-[var(--color-text-muted)] ${rowPy}`}>{activity.program}</TableCell>
                          <TableCell className={rowPy}>
                            <PdtpResponsibleChips display={activity.responsibleDisplay} />
                          </TableCell>
                          <TableCell className={rowPy}>
                            <PdtpStatusBadge status={status} overdueMonths={overdueMonths} />
                          </TableCell>
                          {activity.monthlyPlanned.map((planned, index) => (
                            <TableCellNum
                              key={index}
                              className={[
                                rowPy,
                                planned > 0 ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
                              ].join(" ")}
                            >
                              <div className="space-y-0.5">
                                <div>{formatQuantity(planned)}</div>
                                {worksiteId && (
                                  <div className="text-[11px] text-[var(--color-success)]">
                                    {formatQuantity(activity.monthlyExecuted[index] ?? 0)}
                                  </div>
                                )}
                              </div>
                            </TableCellNum>
                          ))}
                          <TableCellNum className={`font-semibold ${rowPy}`}>{formatQuantity(activity.totalPlanned)}</TableCellNum>
                          <TableCellNum className={`font-semibold ${rowPy}`}>
                            {worksiteId ? formatQuantity(activity.totalExecuted) : "-"}
                          </TableCellNum>
                          {canManage && worksiteId && (
                            <TableCell className={rowPy}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <PdtpExecutionForm activityId={activity.id} worksiteId={worksiteId} year={view.program.year} />
                                <PdtpOverrideForm
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
                                />
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
