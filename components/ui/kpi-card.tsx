import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Info } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip } from "@/components/ui/tooltip"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { CHART_COLORS } from "@/lib/chart-palette"

/**
 * Tarjeta de KPI del producto.
 *
 * `sparkline` y `tone: "danger"` llegaron al absorber `MetricCell`, la tercera
 * implementación de tile que vivía en el dashboard (G-07). Son **opcionales**:
 * los consumidores anteriores (`/analitica`, PDTP, combustibles) no cambian.
 */
export function KpiCard({
  icon,
  label,
  value,
  detail,
  trend,
  tone = "neutral",
  glossary,
  href,
  sparkline,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  trend?: number | null
  tone?: "neutral" | "signal" | "danger"
  glossary?: string
  href?: string
  /** Serie real; se dibuja sólo con ≥2 puntos. Nunca una serie inventada. */
  sparkline?: number[]
}) {
  const hasSparkline = Array.isArray(sparkline) && sparkline.length >= 2
  const card = (
    <Card className={cn(
      "transition-all duration-(--duration-fast)",
      tone === "signal" && "ring-1 ring-[var(--color-signal-line)]",
      tone === "danger" && "ring-1 ring-[var(--color-danger-line)]",
    )}>
      <CardContent className="p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-[var(--color-text-subtle)] truncate">{label}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasSparkline && <MiniSparkline data={sparkline!} color={CHART_COLORS.signal} />}
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                {icon}
              </span>
            )}
            {glossary && (
              <Tooltip content={glossary} side="top">
                <span className="inline-flex cursor-help items-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)]">
                  <Info size={14} />
                </span>
              </Tooltip>
            )}
          </div>
        </div>

        <p className={cn(
          "mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight",
          tone === "danger" ? "text-[var(--color-danger-ink)]" : tone === "signal" ? "text-[var(--color-primary)]" : "text-[var(--color-text)]",
        )}>{value}</p>

        {(typeof trend === "number" || detail) && (
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            {typeof trend === "number" && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                  trend >= 0
                    ? "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]"
                    : "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]"
                )}
              >
                {trend >= 0 ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
                {Math.abs(trend)}%
              </span>
            )}
            {detail && (
              <span className="truncate text-xs text-[var(--color-text-muted)]">{detail}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block h-full">{card}</Link> : card
}
