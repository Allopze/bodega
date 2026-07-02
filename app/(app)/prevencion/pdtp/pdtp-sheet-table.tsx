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
import type { PdtpSheetView } from "@/lib/services/prevention-pdtp"
import { PdtpExecutionForm } from "./pdtp-execution-form"
import { PdtpApprovalButtons } from "./pdtp-approval-buttons"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

type PendingApproval = { id: string; activityId: string; month: number; week: number }

type PdtpSheetTableProps = {
  view: PdtpSheetView
  worksiteId?: string
  canManage?: boolean
  canApprove?: boolean
  pendingApprovals?: PendingApproval[]
}

export function PdtpSheetTable({ view, worksiteId, canManage = false, canApprove = false, pendingApprovals = [] }: PdtpSheetTableProps) {
  const annualPlanned = view.monthlyTotals.reduce((sum, month) => sum + month.planned, 0)
  const annualExecuted = view.monthlyTotals.reduce((sum, month) => sum + month.executed, 0)
  const annualPercent = annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) : null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Actividades" value={view.activities.length} />
        <Metric label="Plan anual" value={formatQuantity(annualPlanned)} />
        <Metric label="Ejecutado" value={worksiteId ? formatQuantity(annualExecuted) : "-"} />
        <Metric label="Cumplimiento" value={annualPercent === null ? "-" : `${annualPercent}%`} />
      </div>

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">N°</TableHead>
              <TableHead className="min-w-[24rem]">Actividad</TableHead>
              <TableHead className="min-w-[14rem]">Programa</TableHead>
              <TableHead className="min-w-[12rem]">Responsables</TableHead>
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
            {view.activities.map((activity) => (
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
            ))}
          </TableBody>
        </Table>
      </TableRoot>
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

