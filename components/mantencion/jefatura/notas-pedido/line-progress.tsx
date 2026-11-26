import { cn } from "@/lib/utils"
import type { PartsNoteLineStage } from "@/lib/services/mantencion/parts/types"
import { lineProgress } from "./parts-notes-format"

/**
 * «Pedido → En compra → Llegó 2/2 → Usado 1/2»: dónde está una línea de la nota. El paso actual va en negrita y
 * con `aria-current`, los hechos atenuados y los que faltan más tenues: el estado no depende del color. Una
 * línea rechazada no avanza y no dibuja la cadena. Componente de servidor.
 */
export function LineProgress({ line }: { line: { stage: PartsNoteLineStage; quantity: number; arrived: number; used: number } }) {
  const steps = lineProgress(line)
  if (!steps) return null
  return (
    <ol aria-label="Avance de la línea" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === "current" ? "step" : undefined}
          className={cn(
            "flex items-center gap-1",
            step.state === "current" && "font-semibold text-[var(--color-text)]",
            step.state === "done" && "text-[var(--color-text-muted)]",
            step.state === "todo" && "text-[var(--color-text-subtle)]",
          )}
        >
          {index > 0 && <span aria-hidden className="text-[var(--color-text-faint)]">{" → "}</span>}
          <span className="font-mono tabular-nums">{step.label}</span>
        </li>
      ))}
    </ol>
  )
}
