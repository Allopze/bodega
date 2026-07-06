import { formatQty } from "@/lib/utils"
import type { ReactNode } from "react"

export function quantitySummary(received: number, requested: number, uom: string): ReactNode {
  if (received >= requested) return <span className="text-[var(--color-success)] font-semibold">Completo</span>
  if (received > 0) return <span className="text-[var(--color-warning)] font-semibold">Parcial ({formatQty(received, uom)} de {formatQty(requested, uom)})</span>
  return <span className="text-[var(--color-text-subtle)]">Sin recibir</span>
}
