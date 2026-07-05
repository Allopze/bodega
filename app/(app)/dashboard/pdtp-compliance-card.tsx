import Link from "next/link"
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { getPdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"
import { listPendingPdtpExecutions } from "@/lib/services/prevention-pdtp"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"

type PdtpComplianceCardProps = {
  year: number
  /** Faena a la que pertence el usuario, o undefined para "todas" (admin global). */
  worksiteId?: string
  pendingCount: number
  target: number
  percent: number | null
  month: number
  week: number
}

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/**
 * Tarjeta compacta de cumplimiento PDTP para el dashboard.
 *
 * Gated por `prevention:pdtp:view` (gating se hace en page.tsx antes de
 * instanciarla). Muestra % de cumplimiento anual con barra de progreso,
 * meta, Nº de pendientes de aprobación y la semana actual.
 */
export function PdtpComplianceCard(props: PdtpComplianceCardProps) {
  const { year, worksiteId, pendingCount, target, percent, month, week } = props
  const targetPct = Math.round(target * 100)
  const value = percent ?? 0
  const belowTarget = percent !== null && percent < targetPct
  const monthLabel = MONTH_LABELS[month - 1] ?? "—"

  return (
    <Link
      href="/prevencion/pdtp"
      data-pressable
      className={cn(
        "group block rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        "p-4 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-tint)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] group-hover:bg-white group-hover:text-[var(--color-primary)]">
            <ChartLineUp size={14} weight="bold" />
          </span>
          <p className="text-eyebrow text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">PDTP {year}</p>
        </div>
        {worksiteId ? (
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Por faena</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Global</span>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span
          className={cn(
            "font-mono text-2xl font-semibold leading-none tabular-nums tracking-tight",
            percent === null
              ? "text-[var(--color-text-faint)]"
              : belowTarget
                ? "text-[var(--color-signal-ink)]"
                : "text-[var(--color-text)]",
          )}
        >
          {percent === null ? "—" : `${percent}%`}
        </span>
        <span className="mb-0.5 text-xs text-[var(--color-text-subtle)]">de meta {targetPct}%</span>
      </div>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]",
            belowTarget ? "bg-[var(--color-signal)]" : "bg-[var(--color-primary)]",
          )}
          style={{ width: `${Math.min(100, Math.max(2, value))}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[var(--color-text-muted)]">
        <span>
          {pendingCount > 0 ? (
            <>
              <span className="font-semibold text-[var(--color-signal-ink)]">{pendingCount}</span>{" "}
              por aprobar
            </>
          ) : (
            <span className="text-[var(--color-success)]">Sin pendientes</span>
          )}
        </span>
        <span className="font-mono tabular-nums">{monthLabel} · S{week}</span>
      </div>
    </Link>
  )
}

export async function loadPdtpComplianceSummary(worksiteIds: string[] | "all") {
  const period = currentPdtpPeriod()
  const targetWorksiteId = worksiteIds === "all" ? undefined : worksiteIds[0]
  const indicators = await getPdtpComplianceIndicators(period.year, targetWorksiteId)
  if (!indicators) return null
  const pending = await listPendingPdtpExecutions(period.year, worksiteIds)
  return {
    year: period.year,
    worksiteId: targetWorksiteId,
    pendingCount: pending.length,
    target: indicators.target,
    percent: indicators.annual.percent === null ? null : Math.round(indicators.annual.percent),
    month: period.month,
    week: period.week,
  } satisfies PdtpComplianceCardProps
}
