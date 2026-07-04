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
import { deriveActivityStatus, type PdtpActivityStatus, type PdtpPeriod } from "@/lib/services/pdtp/period"
import { PdtpExecutionForm } from "./pdtp-execution-form"
import { PdtpApprovalButtons } from "./pdtp-approval-buttons"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

const STATUS_BADGE: Record<PdtpActivityStatus, { label: string; variant: "default" | "success" | "danger" | "outline" }> = {
  executed: { label: "Ejecutado", variant: "success" },
  pending: { label: "Pendiente", variant: "default" },
  overdue: { label: "Atrasado", variant: "danger" },
  not_scheduled: { label: "—", variant: "outline" },
}

function StatusBadge({ status }: { status: PdtpActivityStatus }) {
  const { label, variant } = STATUS_BADGE[status]
  return <Badge variant={variant}>{label}</Badge>
}

type PendingApproval = { id: string; activityId: string; month: number; week: number }

type PdtpSheetTableProps = {
  view: PdtpSheetView
  worksiteId?: string
  canManage?: boolean
  canApprove?: boolean
  pendingApprovals?: PendingApproval[]
  viewMode: "semana" | "anual"
  currentPeriod: PdtpPeriod
}

export function PdtpSheetTable({ view, worksiteId, canManage = false, canApprove = false, pendingApprovals = [], viewMode, currentPeriod }: PdtpSheetTableProps) {
  const annualPlanned = view.monthlyTotals.reduce((sum, month) => sum + month.planned, 0)
  const annualExecuted = view.monthlyTotals.reduce((sum, month) => sum + month.executed, 0)
  const annualPercent = annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) : null

  const weeklyActivities = view.activities.filter(
    (activity) => (activity.monthlyPlanned[currentPeriod.month - 1] ?? 0) > 0,
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Actividades" value={view.activities.length} />
        <Metric label="Plan anual" value={formatQuantity(annualPlanned)} />
        <Metric label="Ejecutado" value={worksiteId ? formatQuantity(annualExecuted) : "-"} />
        <Metric label="Cumplimiento" value={annualPercent === null ? "-" : `${annualPercent}%`} />
      </div>

      {viewMode === "semana" ? (
        weeklyActivities.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
            <p className="font-medium text-[var(--color-text)]">Sin actividades esta semana</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              No hay actividades planificadas para este mes.
            </p>
          </div>
        ) : (
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">N°</TableHead>
                  <TableHead className="min-w-[24rem]">Actividad</TableHead>
                  <TableHead className="min-w-[12rem]">Responsables</TableHead>
                  <TableHead>Estado</TableHead>
                  {canManage && worksiteId && <TableHead className="min-w-[20rem]">Registrar</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeklyActivities.map((activity) => {
                  const status = deriveActivityStatus(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
                  return (
                    <TableRow key={activity.id}>
                      <TableCell className="font-mono text-xs text-[var(--color-text-subtle)]">{activity.n}</TableCell>
                      <TableCell>
                        <div className="max-w-[38rem]">
                          <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{activity.objective}</p>
                        </div>
                      </TableCell>
                      <TableCell>{activity.responsibleDisplay}</TableCell>
                      <TableCell><StatusBadge status={status} /></TableCell>
                      {canManage && worksiteId && (
                        <TableCell>
                          <PdtpExecutionForm
                            activityId={activity.id}
                            worksiteId={worksiteId}
                            defaultMonth={currentPeriod.month}
                            defaultWeek={currentPeriod.week}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
        )
      ) : (
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">N°</TableHead>
                <TableHead className="min-w-[24rem]">Actividad</TableHead>
                <TableHead className="min-w-[14rem]">Programa</TableHead>
                <TableHead className="min-w-[12rem]">Responsables</TableHead>
                <TableHead>Estado</TableHead>
                {MONTH_LABELS.map((month) => (
                  <TableHead key={month} className="text-right">{month}</TableHead>
                ))}
                <TableHead className="text-right">Plan</TableHead>
                <TableHead className="text-right">Ejecutado</TableHead>
                {canManage && worksiteId && <TableHead className="min-w-[20rem]">Registrar</TableHead>}
                {canApprove && worksiteId && pendingApprovals.length > 0 && <TableHead className="min-w-[10rem]">Aprobar</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.activities.map((activity) => {
                const status = deriveActivityStatus(activity.monthlyPlanned, activity.monthlyExecuted, currentPeriod)
                return (
                  <TableRow key={activity.id}>
                    <TableCell className="font-mono text-xs text-[var(--color-text-subtle)]">{activity.n}</TableCell>
                    <TableCell>
                      <div className="max-w-[38rem]">
                        <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{activity.objective}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">{activity.program}</TableCell>
                    <TableCell>{activity.responsibleDisplay}</TableCell>
                    <TableCell><StatusBadge status={status} /></TableCell>
                    {activity.monthlyPlanned.map((planned, index) => (
                      <TableCellNum key={index} className={planned > 0 ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]"}>
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
                    <TableCellNum className="font-semibold">{formatQuantity(activity.totalPlanned)}</TableCellNum>
                    <TableCellNum className="font-semibold">{worksiteId ? formatQuantity(activity.totalExecuted) : "-"}</TableCellNum>
                    {canManage && worksiteId && (
                      <TableCell>
                        <PdtpExecutionForm activityId={activity.id} worksiteId={worksiteId} />
                      </TableCell>
                    )}
                    {canApprove && worksiteId && pendingApprovals.length > 0 && (
                      <TableCell>
                        <PdtpApprovalButtons activityId={activity.id} pendingApprovals={pendingApprovals} />
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </div>
  )
}

export function PdtpWorksitePicker({
  current,
  sheetCode,
  worksites,
}: {
  current?: string
  sheetCode: string
  worksites: Array<{ id: string; name: string }>
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {worksites.map((worksite) => (
        <Link
          key={worksite.id}
          href={`/prevencion/pdtp?hoja=${sheetCode}&faena=${worksite.id}`}
          className={[
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            worksite.id === current
              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {worksite.name}
        </Link>
      ))}
    </div>
  )
}

export function PdtpViewToggle({
  current,
  sheetCode,
  worksiteId,
}: {
  current: "semana" | "anual"
  sheetCode: string
  worksiteId?: string
}) {
  const options: Array<{ value: "semana" | "anual"; label: string }> = [
    { value: "semana", label: "Esta semana" },
    { value: "anual", label: "Vista anual" },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Link
          key={option.value}
          href={`/prevencion/pdtp?hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}`}
          className={[
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            option.value === current
              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {option.label}
        </Link>
      ))}
    </div>
  )
}

export function PdtpSheetPicker({
  current,
  options,
}: {
  current: string
  options: Array<{ code: string; label: string }>
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Link
          key={option.code}
          href={`/prevencion/pdtp?hoja=${option.code}`}
          className={[
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            option.code === current
              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {option.label}
        </Link>
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  )
}

function formatQuantity(value: number) {
  if (value === 0) return "-"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

