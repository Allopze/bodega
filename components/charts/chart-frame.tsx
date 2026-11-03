import type { ReactNode } from "react"

/**
 * Cabecera común de un gráfico del tablero, sin superficie propia (el panel la
 * pone): título, descripción, a la derecha un enlace o selector opcional y,
 * debajo, la cifra principal que responde la pregunta del gráfico.
 *
 * El título es `h3`: `e2e/densidad-kpi.spec.ts` cuenta los `h3` de grupo y los
 * gráficos siempre fueron `h3`.
 */
export function ChartFrame({
  title,
  description,
  headline,
  aside,
  children,
}: {
  title: string
  description?: string
  /** Cifra principal + variación (p. ej. `<span>3</span> solicitudes en octubre <Delta/>`). */
  headline?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-w-0 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-eyebrow text-[var(--color-text)]">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {headline && <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">{headline}</div>}
      <div className="mt-4 min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** La cifra grande de la cabecera: sans, tabular. */
export function ChartHeadlineValue({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <span className={`text-[28px] font-semibold leading-none tabular-nums tracking-tight ${tone === "danger" ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text)]"}`}>
      {children}
    </span>
  )
}

/** Qué mide la cifra grande ("solicitudes en octubre"). */
export function ChartHeadlineCaption({ children }: { children: ReactNode }) {
  return <span className="text-sm text-[var(--color-text-muted)]">{children}</span>
}
