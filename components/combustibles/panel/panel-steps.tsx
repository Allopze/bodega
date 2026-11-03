import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type { PanelStep, PanelStepStatus } from "@/lib/combustibles/panel/steps"
import type { FuelPeriodStatus } from "@/lib/combustibles/period/types"
import { cn } from "@/lib/utils"

/**
 * La firma del Panel: «Octubre 2026 · En curso · 3 de 5 pasos listos» y, debajo,
 * la tira de pasos. Cada paso es un enlace al lugar donde se trabaja; el estado
 * se dice con color, con una palabra visible y con texto para lectores de
 * pantalla (el color solo no basta). El naranja es sólo para pendientes y el
 * rojo sólo para lo fuera de tolerancia o vencido.
 */

const PERIOD_STATUS_LABEL: Record<FuelPeriodStatus, string> = {
  en_curso: "En curso",
  cerrado: "Cerrado",
  futuro: "Todavía no empieza",
}

export function PanelProgress({ label, status, ready, total }: { label: string; status: FuelPeriodStatus; ready: number; total: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-text-muted)]">
      <span className="whitespace-nowrap">
        <strong className="font-semibold text-[var(--color-text)]">{label}</strong> · {PERIOD_STATUS_LABEL[status]}
      </span>
      <div className="min-w-24 flex-1">
        <Progress value={ready} max={total} label={`${ready} de ${total} pasos listos`} />
      </div>
      <span className="whitespace-nowrap">
        <strong className="font-semibold text-[var(--color-text)]">{ready} de {total}</strong> pasos listos
      </span>
    </div>
  )
}

/** Franja superior de cada paso, cifra y variante de la insignia según su estado. */
const STATE_STYLE: Record<PanelStepStatus, { bar: string; value: string; badge: NonNullable<BadgeProps["variant"]> }> = {
  ok: { bar: "bg-[var(--color-primary)]", value: "text-[var(--color-success-ink)]", badge: "success" },
  pendiente: { bar: "bg-[var(--color-signal)]", value: "text-[var(--color-signal-ink)]", badge: "signal" },
  mal: { bar: "bg-[var(--color-danger)]", value: "text-[var(--color-danger-ink)]", badge: "danger" },
  info: { bar: "bg-[var(--color-border-strong)]", value: "text-[var(--color-info-ink)]", badge: "info" },
  sin_datos: { bar: "bg-[var(--color-border-strong)]", value: "text-[var(--color-text-muted)]", badge: "outline" },
}

/** Columnas de escritorio según cuántos pasos ve la persona (clases completas para que Tailwind las vea). */
const COLUMNS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
  5: "md:grid-cols-2 xl:grid-cols-5",
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
                className="group relative flex h-full flex-col gap-1.5 p-5 pt-6 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-[var(--color-primary)]"
              >
                <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", style.bar)} />
                <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-[var(--color-text-muted)]">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[var(--color-text-subtle)]">Paso {step.number}</span>
                    {step.label}
                  </span>
                  <Badge variant={style.badge} size="sm">{step.statusLabel}</Badge>
                </span>
                <p className={cn("mt-1 font-mono text-2xl font-bold leading-tight tabular-nums tracking-tight", style.value)}>
                  {step.figure}
                  {step.figureNote ? <span className="ml-1.5 font-sans text-sm font-medium tracking-normal text-[var(--color-text-muted)]">{step.figureNote}</span> : null}
                </p>
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
