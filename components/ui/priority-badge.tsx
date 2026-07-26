import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { URGENCY_LABELS } from "@/lib/urgency-labels"

/**
 * Render único de prioridad/urgencia.
 *
 * Antes había tres tratamientos para el mismo concepto: badge `signal` (naranja)
 * en el Dashboard, texto rojo plano en Aprobaciones, y badge `warning` para
 * "Alta". Con `critical` y `high` compartiendo la gama naranja, el operador no
 * podía triar de un vistazo — que es justo para lo que sirve la cola de trabajo.
 *
 * Escala cromática ahora monótona: danger > warning > neutro. El naranja
 * `signal` vuelve a su rol exclusivo de "pendiente" (ver DESIGN.md).
 */

const PRIORITY_VARIANT = {
  critical: "danger",
  high:     "warning",
  normal:   "default",
  low:      "default",
} as const

export type Priority = keyof typeof PRIORITY_VARIANT

/** "Baja" no existe en URGENCY_LABELS (es exclusiva de las tareas del dashboard). */
const PRIORITY_LABELS: Record<Priority, string> = {
  ...URGENCY_LABELS,
  low: "Baja",
}

export interface PriorityBadgeProps {
  priority: Priority | string
  size?: React.ComponentProps<typeof Badge>["size"]
  className?: string
}

export function PriorityBadge({ priority, size = "sm", className }: PriorityBadgeProps) {
  const key = (priority in PRIORITY_VARIANT ? priority : "normal") as Priority
  const variant = PRIORITY_VARIANT[key]
  return (
    <Badge
      variant={variant}
      size={size}
      // El punto refuerza la severidad sin depender sólo del color (WCAG 1.4.1);
      // los niveles neutros no lo llevan, para que no compitan visualmente.
      dot={key === "critical" || key === "high"}
      className={className}
    >
      {PRIORITY_LABELS[key]}
    </Badge>
  )
}
