import { cn } from "@/lib/utils"

/**
 * Bullet bar: una medida contra su capacidad y sus umbrales en una sola línea.
 *
 * Reemplaza al medidor radial o a la barra de progreso sin contexto cuando la
 * pregunta es «¿cuánto hay respecto de lo que debería haber?» (nivel de un
 * estanque frente a su capacidad y su punto de reposición, avance frente a la
 * meta). El ojo compara longitudes en una escala común; un radial no.
 *
 * - `value` sobre `max` es la barra.
 * - `markers` son líneas verticales rotuladas (reposición, meta, mínimo).
 * - `tone` dice el estado; quien llama decide cuándo es alerta.
 *
 * Accesible como `role="meter"` con `aria-valuetext` legible; el texto visible
 * repite la cifra, así que el color nunca es el único portador del estado.
 */
export interface BulletBarProps {
  label: string
  value: number
  max: number
  /** Texto de la cifra (p. ej. «12.400 L de 20.000 L»). */
  valueText: string
  markers?: Array<{ value: number; label: string }>
  tone?: "ok" | "warning" | "danger" | "neutral"
  /** Nota bajo la barra (p. ej. «Bajo el punto de reposición»). */
  note?: string
  className?: string
}

const FILL: Record<NonNullable<BulletBarProps["tone"]>, string> = {
  ok: "bg-[var(--color-chart-1)]",
  warning: "bg-[var(--color-signal-ink)]",
  danger: "bg-[var(--color-danger)]",
  neutral: "bg-[var(--color-chart-reference)]",
}

const NOTE: Record<NonNullable<BulletBarProps["tone"]>, string> = {
  ok: "text-[var(--color-text-muted)]",
  warning: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
  neutral: "text-[var(--color-text-muted)]",
}

export function BulletBar({ label, value, max, valueText, markers = [], tone = "ok", note, className }: BulletBarProps) {
  const safeMax = max > 0 ? max : 1
  const pct = clampPct((value / safeMax) * 100)
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-[var(--color-text)]">{label}</span>
        <span className="shrink-0 text-sm tabular-nums text-[var(--color-text)]">{valueText}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={Math.max(0, Math.min(value, safeMax))}
        aria-valuetext={note ? `${valueText}. ${note}` : valueText}
        className="relative mt-2 h-3 rounded-full bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border)]"
      >
        <div className={cn("absolute inset-y-0 left-0 rounded-full", FILL[tone])} style={{ width: `${pct}%` }} />
        {markers.map((marker) => (
          <span
            key={marker.label}
            title={marker.label}
            aria-hidden
            className="absolute -inset-y-1 w-0.5 rounded-full bg-[var(--color-text)]"
            style={{ left: `calc(${clampPct((marker.value / safeMax) * 100)}% - 1px)` }}
          />
        ))}
      </div>
      {(markers.length > 0 || note) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {note && <span className={cn("font-medium", NOTE[tone])}>{note}</span>}
          {markers.map((marker) => (
            <span key={marker.label} className="text-[var(--color-text-muted)]">
              <span aria-hidden className="mr-1 inline-block h-2.5 w-0.5 translate-y-px rounded-full bg-[var(--color-text)]" />
              {marker.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(100, pct))
}
