import { CheckCircle, Target, CalendarBlank, ChartBar } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import type { PdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const QUARTER_LABELS = ["T1", "T2", "T3", "T4"]

function fmtPct(ratio: number | null): string {
  if (ratio === null) return "—"
  return `${Math.round(ratio * 100)}%`
}

function ComplianceBar({ value, target }: { value: number | null; target: number }) {
  const pct = value === null ? 0 : Math.min(1, value)
  const isOk = value !== null && value >= target
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", isOk ? "bg-[var(--color-success)]" : "bg-[var(--color-primary)]")}
        style={{ width: `${Math.round(pct * 100)}%` }}
      />
    </div>
  )
}

export function PdtpIndicatorsPanel({ data }: { data: PdtpComplianceIndicators }) {
  const { monthly, quarterly, annual, target } = data

  return (
    <div className="space-y-3">
      {/* Annual + quarterly summary */}
      <div className="overflow-hidden border-y border-[var(--color-border)]">
        <div className="-ml-px -mt-px flex flex-wrap">
          {/* Annual */}
          <div className="flex-1 min-w-[10rem] border-l border-t border-[var(--color-border)]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                <ChartBar size={13} className="shrink-0 text-[var(--color-text-faint)]" />
                <span className="text-eyebrow">Cumplimiento anual</span>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className={cn(
                  "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
                  annual.percent !== null && annual.percent >= target
                    ? "text-[var(--color-success)]"
                    : "text-[var(--color-text)]"
                )}>
                  {fmtPct(annual.percent)}
                </span>
                <span className="mb-1 text-xs text-[var(--color-text-subtle)]">{annual.executed}/{annual.planned}</span>
              </div>
              <ComplianceBar value={annual.percent} target={target} />
            </div>
          </div>

          {/* Target */}
          <div className="flex-1 min-w-[8rem] border-l border-t border-[var(--color-border)]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Target size={13} className="shrink-0 text-[var(--color-text-faint)]" />
                <span className="text-eyebrow">Meta</span>
              </div>
              <div className="mt-2">
                <span className="font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight text-[var(--color-text)]">
                  {Math.round(target * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Quarterly */}
          {quarterly.map((q) => (
            <div key={q.quarter} className="flex-1 min-w-[7rem] border-l border-t border-[var(--color-border)]">
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <CalendarBlank size={13} className="shrink-0 text-[var(--color-text-faint)]" />
                  <span className="text-eyebrow">{QUARTER_LABELS[q.quarter - 1]}</span>
                </div>
                <div className="mt-2 flex items-end gap-1.5">
                  <span className={cn(
                    "font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight",
                    q.percent !== null && q.percent >= target ? "text-[var(--color-success)]" : "text-[var(--color-text)]"
                  )}>
                    {fmtPct(q.percent)}
                  </span>
                </div>
                <ComplianceBar value={q.percent} target={target} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly grid */}
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-1 pr-3">Mes</TableHead>
              <TableHead className="text-right">Prog.</TableHead>
              <TableHead className="text-right">Ejec.</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead>Meta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {monthly.map((m) => {
              const meetsTarget = m.percent !== null && m.percent >= target
              return (
                <TableRow key={m.month}>
                  <TableCell className="py-1.5 pl-1 pr-3 text-xs font-medium text-[var(--color-text-subtle)]">{MONTH_LABELS[m.month - 1]}</TableCell>
                  <TableCellNum className="px-2 py-1.5 text-xs">{m.planned}</TableCellNum>
                  <TableCellNum className="px-2 py-1.5 text-xs">{m.executed}</TableCellNum>
                  <TableCellNum className={cn("px-2 py-1.5 text-xs font-semibold", meetsTarget ? "text-[var(--color-success)]" : m.executed > 0 ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text-faint)]")}>
                    {fmtPct(m.percent)}
                  </TableCellNum>
                  <TableCell className="px-2 py-1.5">
                    {meetsTarget && <CheckCircle size={13} className="text-[var(--color-success)]" />}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
