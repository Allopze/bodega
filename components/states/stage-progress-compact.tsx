import * as React from "react"
import { cn } from "@/lib/utils"
import { STAGES } from "@/lib/work-queue-labels"
import type { RequestProgress } from "@/lib/work-queue"

/**
 * Indicador compacto de etapa para celdas de tabla y tarjetas móviles.
 *
 * Decisión de producto (2026-10-05): las listas dicen "etapa + qué falta", nunca
 * una persona ni un rol. Este componente es el contrato compartido entre
 * Solicitudes y Recepción; lo alimenta cualquier `RequestProgress`
 * (`buildRequestProgress` o `buildOcProgress`).
 *
 * Cada etapa se distingue por FORMA, no sólo por color:
 *   - completada: círculo lleno con tilde
 *   - actual:     anillo con punto central (naranja signal: hay algo pendiente)
 *   - pendiente:  círculo pequeño y hueco
 * Componente de servidor: sin hooks ni estado.
 */
export function StageProgressCompact({
  progress,
  className,
}: {
  progress: RequestProgress
  className?: string
}) {
  const currentIndex = Math.max(0, STAGES.indexOf(progress.currentStage))
  const completed = new Set(progress.completedStages)
  const currentDone = completed.has(progress.currentStage)
  const nextAction = progress.nextAction.trim()

  const stageLabel = currentDone
    ? `Etapa ${progress.currentStage} completada (${currentIndex + 1} de ${STAGES.length})`
    : `Etapa ${currentIndex + 1} de ${STAGES.length}: ${progress.currentStage}`
  const ariaLabel = nextAction ? `${stageLabel}. ${nextAction}` : `${stageLabel}.`

  return (
    <div role="img" aria-label={ariaLabel} className={cn("flex w-full min-w-[9.5rem] max-w-[13.75rem] flex-col gap-1", className)}>
      <ol aria-hidden className="flex items-center">
        {STAGES.map((stage, index) => {
          const isDone = completed.has(stage)
          const isCurrent = index === currentIndex && !isDone
          const isLast = index === STAGES.length - 1
          return (
            <li key={stage} title={stage} className={cn("flex items-center", !isLast && "flex-1")}>
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  isDone && "border-[var(--color-primary)] bg-[var(--color-primary)] text-white",
                  isCurrent && "border-2 border-[var(--color-signal)] bg-[var(--color-surface)]",
                  !isDone && !isCurrent && "size-3 border-[var(--color-border-strong)] bg-[var(--color-surface)]",
                )}
              >
                {isDone && (
                  <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5 5 9l4.5-5.5" />
                  </svg>
                )}
                {isCurrent && <span className="size-1.5 rounded-full bg-[var(--color-signal)]" />}
              </span>
              {!isLast && (
                <span
                  className={cn(
                    "mx-0.5 h-px flex-1",
                    isDone ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]",
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
      <p aria-hidden title={`${progress.currentStage}: ${nextAction}`} className="truncate text-xs leading-snug text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text)]">{progress.currentStage}</span>
        {nextAction ? ` · ${nextAction}` : ""}
      </p>
    </div>
  )
}
