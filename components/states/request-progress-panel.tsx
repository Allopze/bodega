import * as React from "react"
import { CheckCircle, Circle, Clock } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import type { RequestProgress } from "@/lib/work-queue"

const STAGES = ["Solicitado", "Aprobación", "Compra", "Recepción", "Entrega"]

const RequestProgressPanelInner = React.memo(function RequestProgressPanelInner({ progress }: { progress: RequestProgress }) {
  const currentIndex = Math.max(0, STAGES.indexOf(progress.currentStage))
  const completed = new Set(progress.completedStages)

  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-h2 text-[var(--color-text)]">Seguimiento del pedido</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{progress.nextAction}</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]">
            <Clock size={13} />
            {progress.currentStage}
          </span>
        </div>
      </div>

      <div className="space-y-5 px-4 py-5">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Etapas del pedido">
          {STAGES.map((stage, index) => {
            const isDone = completed.has(stage)
            const isCurrent = index === currentIndex
            const Icon = isDone ? CheckCircle : Circle

            return (
              <li
                key={stage}
                className={cn(
                  "flex items-center gap-2 rounded-[var(--radius)] border px-3 py-2 text-xs",
                  isDone && "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success)]",
                  isCurrent && !isDone && "border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]",
                  !isDone && !isCurrent && "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]",
                )}
              >
                <Icon size={14} weight={isDone ? "fill" : "regular"} />
                <span className="font-medium">{stage}</span>
              </li>
            )
          })}
        </ol>

        <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
          {progress.items.map((item) => (
            <div key={item.id} className="grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{item.productName}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  {item.quantityLabel} · {item.stageLabel}
                </p>
              </div>
              <span className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-2 py-1 text-xs font-medium text-[var(--color-text-muted)]">
                {item.statusLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
})

export const RequestProgressPanel = RequestProgressPanelInner
