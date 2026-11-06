import * as React from "react"
import { CheckCircle, Clock, Prohibit, Question } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import {
  EXPIRY_STATE_LABEL,
  EXPIRY_STATE_VARIANT,
  expiryRelativeText,
  type ExpiryState,
  type ExpiryStatus as ExpiryStatusValue,
} from "@/lib/expiry"
import { cn, formatDate } from "@/lib/utils"

const ICON: Record<ExpiryState, React.ComponentType<{ size?: number; weight?: "bold" | "fill" | "regular"; className?: string; "aria-hidden"?: boolean }>> = {
  vigente: CheckCircle,
  por_vencer: Clock,
  vencido: Prohibit,
  sin_fecha: Question,
}

export interface ExpiryStatusProps {
  status: ExpiryStatusValue
  /** Ventana de aviso vigente (días): decide desde cuándo se cuentan días. */
  warningDays: number
  /**
   * `compact`: pastilla y frase en una línea (celda de tabla).
   * `stacked`: frase arriba, pastilla debajo (ficha, hoja de edición).
   */
  layout?: "compact" | "stacked"
  /** Prefijo de la frase: «Rev. técnica» → «Rev. técnica · vence en 9 días». */
  subject?: React.ReactNode
  /** Reemplaza el rótulo del estado («Vencida» en vez de «Vencido» para una licencia). */
  label?: string
  /** Texto cuando no hay fecha («Sin fecha registrada»). */
  emptyText?: string
  className?: string
}

/**
 * Estado de un vencimiento con color, ícono y texto: nunca sólo color (WCAG
 * 1.4.1). La fecha absoluta queda en `title` y en el texto accesible, la
 * relativa se lee de un vistazo. Lógica en `lib/expiry.ts`.
 */
export function ExpiryStatus({
  status,
  warningDays,
  layout = "compact",
  subject,
  label,
  emptyText = "Sin fecha registrada",
  className,
}: ExpiryStatusProps) {
  const Icon = ICON[status.state]
  const relative = expiryRelativeText(status, warningDays)
  const absolute = status.expiresAt ? formatDate(status.expiresAt) : null
  const badge = (
    <Badge variant={EXPIRY_STATE_VARIANT[status.state]} size="sm" className="shrink-0">
      <Icon size={12} weight="bold" aria-hidden />
      {label ?? EXPIRY_STATE_LABEL[status.state]}
    </Badge>
  )
  const phrase = (
    <span
      className={cn(
        "text-xs",
        status.state === "vencido" ? "font-medium text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)]",
      )}
    >
      {subject && <span className="font-medium text-[var(--color-text)]">{subject}</span>}
      {subject && (relative || !absolute) && <span aria-hidden> · </span>}
      {relative ?? (absolute ? null : emptyText)}
    </span>
  )

  return (
    <span
      className={cn(
        layout === "compact" ? "inline-flex flex-wrap items-center gap-x-2 gap-y-1" : "inline-flex flex-col items-start gap-1",
        className,
      )}
      title={absolute ? `Vence el ${absolute}` : undefined}
    >
      {layout === "compact" ? <>{badge}{phrase}</> : <>{phrase}{badge}</>}
      {absolute && <span className="sr-only">Fecha de vencimiento: {absolute}.</span>}
    </span>
  )
}
