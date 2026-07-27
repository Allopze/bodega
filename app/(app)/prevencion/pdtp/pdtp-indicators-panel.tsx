import { CheckCircle, Target, ChartBar } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PersistedDetails } from "./persisted-details"
import type { PdtpComplianceIndicators, PdtpIntegralCompliance } from "@/lib/services/prevention-pdtp"

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const QUARTER_LABELS = ["Trim. 1", "Trim. 2", "Trim. 3", "Trim. 4"]

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

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" })

function fmtDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso))
}

export function PdtpIndicatorsPanel({ data, integral, asOf }: { data: PdtpComplianceIndicators; integral?: PdtpIntegralCompliance | null; asOf?: string }) {
  const { monthly, quarterly, annual, target, lastExecutionUpdatedAt } = data

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <p>El cumplimiento formal considera únicamente ejecuciones aprobadas.</p>
        <p>
          {asOf && <span>Datos al {fmtDateTime(asOf)}</span>}
          {lastExecutionUpdatedAt && <span className="ml-2">· Última ejecución aprobada: {fmtDateTime(lastExecutionUpdatedAt)}</span>}
        </p>
      </div>

      {/* Cabecera compacta: integral (con desglose de ejes en una línea) + anual + meta.
          Los trimestres viven en el desglose plegable para no saturar la entrada. */}
      <div className="overflow-hidden border-y border-[var(--color-border)]">
        <div className="-ml-px -mt-px flex flex-wrap">
          {integral && <IntegralTile integral={integral} />}

          {/* Cumplimiento anual: navega a los registros que lo componen. */}
          <a href="#registros-pdtp" className="flex-1 min-w-[10rem] border-l border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]">
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
          </a>

          {/* Meta */}
          <div className="flex-1 min-w-[8rem] border-l border-t border-[var(--color-border)]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Target size={13} className="shrink-0 text-[var(--color-text-faint)]" />
                <span className="text-eyebrow">Meta anual</span>
              </div>
              <div className="mt-2">
                <span className="font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight text-[var(--color-text)]">
                  {Math.round(target * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desglose mensual + trimestral — colapsable con estado persistido */}
      <PersistedDetails storageKey="indicators-monthly"
        summary={<>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="shrink-0 rotate-0 transition-transform duration-200 group-open:rotate-90"
            aria-hidden
          >
            <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          Ver desglose mensual y trimestral
        </>}
      >

        {/* Resumen trimestral */}
        <div className="mt-3 flex flex-wrap gap-2">
          {quarterly.map((q) => {
            const meetsTarget = q.percent !== null && q.percent >= target
            return (
              <div key={q.quarter} className="min-w-[6rem] flex-1 rounded-(--radius) border border-[var(--color-border)] px-3 py-2">
                <span className="text-eyebrow">{QUARTER_LABELS[q.quarter - 1]}</span>
                <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                  <span className={meetsTarget ? "text-[var(--color-success)]" : "text-[var(--color-text)]"}>{fmtPct(q.percent)}</span>
                </div>
                <ComplianceBar value={q.percent} target={target} />
              </div>
            )
          })}
        </div>

        <div className="mt-3">
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
                      <TableCell className="py-1.5 pl-1 pr-3 text-xs font-medium text-[var(--color-text-subtle)]">
                        <a href="#registros-pdtp" className="hover:text-[var(--color-primary)] hover:underline" title="Ver los registros de este mes">
                          {MONTH_LABELS[m.month - 1]}
                        </a>
                      </TableCell>
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
      </PersistedDetails>
    </div>
  )
}

/**
 * Cumplimiento integral en un solo tile: el resultado combinado grande y, debajo,
 * los tres ejes ponderados en una línea compacta (antes eran tres tiles aparte).
 * El peso de cada eje va en el `title` para no cargar la vista con "peso 50%".
 */
function IntegralTile({ integral }: { integral: PdtpIntegralCompliance }) {
  const axes: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "Ejecución", value: integral.ejecucion !== null ? integral.ejecucion * 100 : null, weight: integral.pesos.ejecucion },
    { label: "Verificación", value: integral.verificacion, weight: integral.pesos.verificacion },
    { label: "Cierre", value: integral.cierre, weight: integral.pesos.cierre },
  ]

  return (
    <div className="flex-1 min-w-[16rem] border-l border-t border-[var(--color-border)]">
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <ChartBar size={13} className="shrink-0 text-[var(--color-text-faint)]" />
          <span
            className="text-eyebrow"
            title="Resultado combinado del programa: 50% ejecución + 30% verificación + 20% cierre"
          >
            Cumplimiento integral
          </span>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-mono text-[1.375rem] font-semibold leading-none tabular-nums tracking-tight text-[var(--color-text)]">
            {integral.integral !== null ? `${integral.integral}%` : "—"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
          {axes.map((axis) => (
            <span key={axis.label} title={`Peso ${Math.round(axis.weight * 100)}% en el cumplimiento integral`}>
              {axis.label} <span className="font-mono font-semibold text-[var(--color-text)]">{axis.value !== null ? `${Math.round(axis.value)}%` : "—"}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
