import Link from "next/link"
import { ChartLineUp } from "@phosphor-icons/react/dist/ssr"
import { cn, formatDateTime } from "@/lib/utils"
import { getPdtpComplianceIndicators, getPdtpIntegralCompliance } from "@/lib/services/prevention-pdtp"
import { listPendingPdtpExecutions } from "@/lib/services/prevention-pdtp"
import { getPdtpComplianceIndicatorsForScope } from "@/lib/services/pdtp/compliance"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"

type PdtpComplianceCardProps = {
  year: number
  /** Faena única seleccionada para calcular cumplimiento. */
  worksiteId?: string
  /** Faenas que suma el agregado cuando no hay faena única. */
  worksiteCount: number
  pendingCount: number
  target: number
  percent: number | null
  integralPercent: number | null
  planned: number
  executed: number
  /** Avance planificado acumulado hasta el período en curso (0–1). */
  expectedPercent: number | null
  /** Diferencia entre avance real y plan acumulado, en puntos porcentuales. */
  variancePercent: number | null
  lastExecutionUpdatedAt: string | null
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
  const {
    year,
    worksiteId,
    worksiteCount,
    pendingCount,
    target,
    percent,
    integralPercent,
    planned,
    executed,
    expectedPercent,
    variancePercent,
    lastExecutionUpdatedAt,
    month,
    week,
  } = props
  const targetPct = Math.round(target * 100)
  const value = percent === null ? 0 : Math.round(percent * 100)
  const expectedPct = expectedPercent === null ? null : Math.round(expectedPercent * 100)
  const belowTarget = percent !== null && percent < target
  const monthLabel = MONTH_LABELS[month - 1] ?? "—"

  return (
    <Link
      href="/prevencion/pdtp"
      data-pressable
      className={cn(
        "group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs transition-all duration-150 ease-out",
        "hover:border-[var(--color-primary-line)] hover:bg-[var(--color-surface-2)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-surface)] group-hover:text-[var(--color-primary)]">
            <ChartLineUp size={14} weight="bold" />
          </span>
          <p className="text-eyebrow text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">PDTP {year}</p>
        </div>
        {/* El agregado global existe (mismo motor que la sección Prevención);
            antes esta tarjeta pedía "selecciona faena" mientras esa sección
            publicaba el porcentaje global cuatro pantallas más abajo (I-04). */}
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
          {worksiteId ? "Por faena" : `Global · ${worksiteCount} faenas`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-1">
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
          {percent === null ? "—" : `${value}%`}
        </span>
        <span className="mb-0.5 text-xs text-[var(--color-text-subtle)]">avance real</span>
        {integralPercent !== null && (
          <span className="mb-0.5 text-xs text-[var(--color-text-faint)]">· integral {integralPercent}%</span>
        )}
      </div>

      <div
        className="relative mt-3 h-2 w-full overflow-visible rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-label={`Avance real ${percent === null ? "sin datos" : `${value}%`}; avance esperado ${expectedPct === null ? "sin plan" : `${expectedPct}%`}; meta anual ${targetPct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? 0 : value}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]",
            belowTarget ? "bg-[var(--color-signal)]" : "bg-[var(--color-primary)]",
          )}
          style={{ width: `${percent === null ? 0 : Math.min(100, Math.max(2, value))}%` }}
        />
        {expectedPct !== null && (
          <span
            className="absolute top-[-3px] h-3.5 w-0.5 rounded-full bg-[var(--color-rule)]"
            style={{ left: `${Math.min(100, Math.max(0, expectedPct))}%` }}
            title={`Avance esperado ${expectedPct}%`}
            aria-hidden
          />
        )}
        <span
          className="absolute top-[-2px] h-3 w-px bg-[var(--color-text-faint)]"
          style={{ left: `${Math.min(100, Math.max(0, targetPct))}%` }}
          title={`Meta anual ${targetPct}%`}
          aria-hidden
        />
      </div>

      <div className="mt-3 grid gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)] sm:grid-cols-2">
        <span className="min-w-0">
          {pendingCount > 0 ? (
            <>
              <span className="font-semibold text-[var(--color-signal-ink)]">{pendingCount}</span>{" "}
              por aprobar
            </>
          ) : (
            <span className="text-[var(--color-success)]">Sin pendientes</span>
          )}
        </span>
        <span className="font-mono tabular-nums text-[var(--color-text-subtle)]">
          {executed.toLocaleString("es-CL")} de {planned.toLocaleString("es-CL")} planificado
        </span>
        {expectedPct !== null && (
          <span>
            Esperado al período: <strong className="font-mono tabular-nums text-[var(--color-text)]">{expectedPct}%</strong>
            {variancePercent !== null && (
              <span className={cn("ml-1 font-mono tabular-nums", variancePercent < 0 ? "text-[var(--color-danger-ink)]" : "text-[var(--color-success-ink)]")}>
                ({variancePercent > 0 ? "+" : ""}{variancePercent} pp)
              </span>
            )}
          </span>
        )}
        <span className="font-mono tabular-nums">{monthLabel} · S{week} · meta {targetPct}%</span>
        {lastExecutionUpdatedAt && (
          <span className="sm:col-span-2">Última ejecución validada: {formatDateTime(lastExecutionUpdatedAt)}</span>
        )}
      </div>
    </Link>
  )
}

export async function loadPdtpComplianceSummary(worksiteIds: string[]) {
  const period = currentPdtpPeriod()
  const targetWorksiteId = worksiteIds.length === 1 ? worksiteIds[0] : undefined
  /*
   * Multi-faena usa el mismo agregado que la sección Prevención
   * (`getPdtpComplianceIndicatorsForScope`). Antes esta tarjeta anulaba el
   * porcentaje y pedía "selecciona faena" mientras esa sección publicaba el
   * global cuatro pantallas más abajo (I-04). El integral sigue siendo
   * por-faena: ese cálculo sí no tiene versión agregada.
   */
  const indicators = targetWorksiteId
    ? await getPdtpComplianceIndicators(period.year, targetWorksiteId)
    : await getPdtpComplianceIndicatorsForScope(period.year, worksiteIds)
  if (!indicators) return null
  const [pending, integral] = await Promise.all([
    listPendingPdtpExecutions(worksiteIds, { year: period.year }),
    targetWorksiteId ? getPdtpIntegralCompliance(period.year, targetWorksiteId) : Promise.resolve(null),
  ])
  const planned = indicators.annual.planned
  const executed = indicators.annual.executed
  const plannedThroughCurrentMonth = indicators.monthly
    .slice(0, period.month)
    .reduce((sum, entry) => sum + entry.planned, 0)
  const expectedPercent = planned > 0 ? plannedThroughCurrentMonth / planned : null
  const variancePercent = indicators.annual.percent !== null && expectedPercent !== null
    ? Math.round((indicators.annual.percent - expectedPercent) * 10_000) / 100
    : null

  return {
    year: period.year,
    worksiteId: targetWorksiteId,
    worksiteCount: worksiteIds.length,
    pendingCount: pending.length,
    target: indicators.target,
    percent: indicators.annual.percent,
    integralPercent: integral?.integral ?? null,
    planned,
    executed,
    expectedPercent,
    variancePercent,
    lastExecutionUpdatedAt: indicators.lastExecutionUpdatedAt,
    month: period.month,
    week: period.week,
  } satisfies PdtpComplianceCardProps
}
