import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import type { PanelStep, PanelStepStatus } from "@/lib/combustibles/panel/steps"
import type { FuelPeriodStatus } from "@/lib/combustibles/period/types"
import { cn } from "@/lib/utils"

/**
 * La firma del Panel: «Octubre 2026 · En curso · 3 de 5 pasos listos» y, debajo,
 * la tira de pasos. Cada paso es un enlace al lugar donde se trabaja; el estado
 * se dice con una insignia con palabra visible (el color solo no basta) y el
 * borde de la tarjeta no se colorea. El avance se muestra una sola vez, como
 * texto: no hay barra además (excepción declarada en AGENTS.md, A1/A5).
 */

const PERIOD_STATUS_LABEL: Record<FuelPeriodStatus, string> = {
  en_curso: "En curso",
  cerrado: "Cerrado",
  futuro: "Todavía no empieza",
}

export function PanelProgress({ label, status, ready, total }: { label: string; status: FuelPeriodStatus; ready: number; total: number }) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-text-muted)]">
      <span className="whitespace-nowrap">
        <strong className="font-semibold text-[var(--color-text)]">{label}</strong> · {PERIOD_STATUS_LABEL[status]}
      </span>
      <span className="whitespace-nowrap">
        <strong className="font-semibold text-[var(--color-text)]">{ready} de {total}</strong> pasos listos
      </span>
    </p>
  )
}

/** Color de la cifra y variante de la insignia según el estado del paso. */
const STATE_STYLE: Record<PanelStepStatus, { value: string; badge: NonNullable<BadgeProps["variant"]> }> = {
  ok: { value: "text-[var(--color-success-ink)]", badge: "success" },
  pendiente: { value: "text-[var(--color-signal-ink)]", badge: "signal" },
  mal: { value: "text-[var(--color-danger-ink)]", badge: "danger" },
  info: { value: "text-[var(--color-info-ink)]", badge: "info" },
  sin_datos: { value: "text-[var(--color-text-muted)]", badge: "outline" },
}

/** Columnas de escritorio según cuántos pasos ve la persona (clases completas para que Tailwind las vea). */
const COLUMNS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
  5: "md:grid-cols-2 xl:grid-cols-5",
}

/**
 * La cifra grande del paso. Sólo un número (o un monto) va en la cifra mono: una
 * palabra («Sin datos», «Al día», «Cuadra») en ese tamaño y esa familia se lee
 * como un dato y no como un estado, así que va en sans y en gris. «3 fuera» es
 * ambas cosas: el 3 es la cifra y «fuera» la palabra que la acompaña.
 */
function splitFigure(figure: string): { numeral: string | null; word: string | null } {
  const match = /^(-?\$?\d[\d.,]*[KM]?)(?:\s+(.+))?$/.exec(figure)
  if (!match) return { numeral: null, word: figure }
  return { numeral: match[1] ?? null, word: match[2] ?? null }
}

function StepFigure({ figure, note, valueClass }: { figure: string; note?: string; valueClass: string }) {
  const { numeral, word } = splitFigure(figure)
  const noteClass = "ml-1.5 text-sm font-medium text-[var(--color-text-muted)]"
  if (numeral === null) {
    return (
      <p className="mt-1 flex min-h-8 items-center text-base font-medium leading-tight text-[var(--color-text-muted)]">
        {figure}
        {note ? <span className="ml-1.5 text-sm">{note}</span> : null}
      </p>
    )
  }
  return (
    <p className={cn("mt-1 min-h-8 font-sans text-2xl font-semibold leading-tight tabular-nums", valueClass)}>
      {numeral}
      {word ? <span className={noteClass}>{word}</span> : null}
      {note ? <span className={noteClass}>{note}</span> : null}
    </p>
  )
}

export function PanelStepsStrip({ steps }: { steps: PanelStep[] }) {
  return (
    <section aria-labelledby="panel-pasos" className="mb-5">
      <h2 id="panel-pasos" className="sr-only">Pasos para cerrar el período</h2>
      {/* Las celdas se separan con una línea de 1 px (el fondo del contenedor asoma entre ellas). */}
      <ol className={cn("grid gap-px overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-border)]", COLUMNS[steps.length] ?? "md:grid-cols-2")}>
        {steps.map((step) => {
          const style = STATE_STYLE[step.status]
          return (
            <li key={step.key} data-step={step.key} data-status={step.status} className="bg-[var(--color-surface)]">
              <Link
                href={step.href}
                className="group flex h-full flex-col gap-1.5 p-5 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-[var(--color-primary)]"
              >
                {/* Título e insignia en la misma línea: el título se trunca antes de que la insignia caiga a otra. */}
                <span className="flex items-center justify-between gap-2 text-sm text-[var(--color-text-muted)]">
                  <span className="flex min-w-0 items-center gap-2" title={step.label}>
                    <span className="shrink-0 font-mono text-xs text-[var(--color-text-subtle)]"><span className="sr-only">Paso </span>{step.number}</span>
                    <span className="truncate">{step.label}</span>
                  </span>
                  <Badge variant={style.badge} size="sm" className="shrink-0 whitespace-nowrap">{step.statusLabel}</Badge>
                </span>
                <StepFigure figure={step.figure} note={step.figureNote} valueClass={style.value} />
                <h3 className="text-base font-semibold text-[var(--color-text)]">{step.heading}</h3>
                <p className="text-sm text-[var(--color-text-muted)]">{step.phrase}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-[var(--color-primary-ink)]">
                  {step.cta}
                  <ArrowRight size={14} weight="bold" aria-hidden className="transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          )
        })}
        {/* Con un número impar de pasos en dos columnas queda un hueco: se rellena para que la línea de fondo no asome. */}
        {steps.length % 2 === 1 && steps.length !== 3 ? <li aria-hidden className="hidden bg-[var(--color-surface)] md:block xl:hidden" /> : null}
      </ol>
    </section>
  )
}
