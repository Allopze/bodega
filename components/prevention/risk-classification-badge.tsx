import { CheckCircle, Info, Warning, WarningOctagon } from "@phosphor-icons/react/dist/ssr"
import { CLASSIFICATION_LABEL, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"

/* El color nunca es la única señal (§8.3 del spec): rótulo + ícono + forma.
 * Texto siempre con tokens -ink; el Intolerable, relleno sólido y texto blanco. */
const STYLE: Record<RiskClassification, { className: string; Icon: typeof Info }> = {
  tolerable: { className: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]", Icon: CheckCircle },
  moderate: { className: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]", Icon: Info },
  important: { className: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)] border border-[var(--color-danger-line)]", Icon: Warning },
  intolerable: { className: "bg-[var(--color-danger)] text-white font-semibold", Icon: WarningOctagon },
}

export function RiskClassificationBadge({ classification, magnitude, size = "md" }: { classification: RiskClassification | null; magnitude?: number | null; size?: "sm" | "md" }) {
  if (!classification) return <span className="text-xs text-[var(--color-text-subtle)]">Sin evaluar</span>
  const { className, Icon } = STYLE[classification]
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md", size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs", className)}>
      <Icon aria-hidden weight="bold" className="size-3.5" />
      {CLASSIFICATION_LABEL[classification]}
      {typeof magnitude === "number" ? <span className="tabular-nums opacity-90" title="MR: magnitud del riesgo (probabilidad × consecuencia)"> · MR {magnitude}</span> : null}
    </span>
  )
}
