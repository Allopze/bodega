import { cn, formatPercent, formatQty } from "@/lib/utils"
import type { CrossFilterAction } from "@/lib/services/mantencion/looker/filters"
import { FilterToggle } from "./filter-toggle"

export interface CrossFilterBarItem {
  key: string
  label: string
  value: number
  detail?: string
  tone?: "ok" | "warn" | "danger" | "muted"
  color?: string
}

const TONE_TEXT: Record<NonNullable<CrossFilterBarItem["tone"]>, string> = {
  ok: "text-[var(--color-success-ink)]",
  warn: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
  muted: "text-[var(--color-text-muted)]",
}

function valueText(value: number, mode: "rank" | "percent" | "delta", unit: string, digits: number): string {
  if (mode === "percent") return formatPercent(value, digits)
  const number = formatQty(value, undefined, { maximumFractionDigits: digits })
  const sign = mode === "delta" && value > 0 ? "+" : ""
  return `${sign}${number}${unit}`
}

/**
 * Barras horizontales de un ranking, un % de cumplimiento o un delta. Cada fila es un
 * `FilterToggle` (button real con `aria-pressed`), así el teclado filtra igual que el mouse.
 * El componente que emite el filtro lo ignora en su consulta: todas las filas siguen visibles y
 * sólo se atenúan las demás.
 */
export function CrossFilterBars({
  ariaLabel,
  items,
  unit = "",
  digits = 0,
  mode = "rank",
  max,
  limit,
  selectedKey,
  actionFor,
  emptyMessage = "Sin datos en el período.",
  className,
}: {
  ariaLabel: string
  items: CrossFilterBarItem[]
  unit?: string
  digits?: number
  mode?: "rank" | "percent" | "delta"
  /** Denominador de las barras. En `percent` es 100; en `delta`, el mayor valor absoluto. */
  max?: number
  limit?: number
  selectedKey?: string | null
  actionFor: (item: CrossFilterBarItem) => CrossFilterAction
  emptyMessage?: string
  className?: string
}) {
  if (items.length === 0) {
    return <p className="px-1 py-3 text-sm text-[var(--color-text-muted)]">{emptyMessage}</p>
  }
  const shown = limit ? items.slice(0, limit) : items
  const maxAbs = mode === "delta"
    ? Math.max(1, ...shown.map((item) => Math.abs(item.value)))
    : Math.max(1, max ?? (mode === "percent" ? 100 : Math.max(...shown.map((item) => Math.abs(item.value)))))

  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex flex-col gap-0.5", className)}>
      {shown.map((item) => {
        const active = selectedKey === item.key
        const ratio = Math.min(1, Math.abs(item.value) / maxAbs)
        const negative = mode === "delta" && item.value < 0
        const color = mode === "delta"
          ? negative ? "var(--mant-orange)" : "var(--mant-green)"
          : mode === "percent" ? "var(--mant-green)" : item.color ?? "var(--mant-green)"
        return (
          <FilterToggle
            key={item.key}
            action={actionFor(item)}
            aria-label={`${item.label}: ${valueText(item.value, mode, unit, digits)}`}
            className={cn(
              "w-full gap-2 px-1 py-1",
              selectedKey && !active && "opacity-40",
              mode === "delta" && "items-center",
            )}
            title={item.detail ? `${item.label} · ${item.detail}` : item.label}
          >
            <span className="w-28 shrink-0 truncate text-xs text-[var(--color-text)] sm:w-36">{item.label}</span>
            <span className="relative h-2 min-w-0 flex-1 rounded-full bg-[var(--color-surface-3)]" aria-hidden>
              {mode === "delta" ? (
                <>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-strong)]" />
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: negative ? `${50 - ratio * 50}%` : "50%",
                      width: `${ratio * 50}%`,
                      background: color,
                      border: negative ? "1px solid var(--color-signal-ink)" : undefined,
                    }}
                  />
                </>
              ) : (
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${ratio * 100}%`, background: color }} />
              )}
            </span>
            <span className={cn(
              "w-20 shrink-0 text-right font-mono text-2xs tabular-nums",
              item.tone ? TONE_TEXT[item.tone] : "text-[var(--color-text)]",
            )}>
              {valueText(item.value, mode, unit, digits)}
            </span>
          </FilterToggle>
        )
      })}
      {limit && items.length > limit && (
        <p className="px-1 pt-1 text-2xs text-[var(--color-text-subtle)]">
          {limit} de {items.length}; ordena por magnitud.
        </p>
      )}
    </div>
  )
}
