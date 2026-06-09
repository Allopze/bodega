import type { InventoryMovementWithRelations } from "./types"
import { formatQty, formatDate } from "@/lib/utils"

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:         "Ingreso OC",
  egreso_entrega:     "Entrega",
  ingreso_devolucion: "Devolución",
}

const MOVEMENT_QTY_CLASS: Record<string, string> = {
  ingreso_oc:         "text-[var(--color-success)] font-medium",
  egreso_entrega:     "text-[var(--color-danger)]",
  ingreso_devolucion: "text-[var(--color-success)]",
}

export interface KardexTableProps {
  movements: InventoryMovementWithRelations[]
}

export function KardexTable({ movements }: KardexTableProps) {
  if (movements.length === 0) return null

  return (
    <div>
      <h2 className="text-h2 mb-3">Kardex: últimos 50 movimientos</h2>
      <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
        <table className="w-full text-sm" aria-label="Kardex de movimientos de inventario">
          <caption className="sr-only">Últimos 50 movimientos de inventario registrados en todas las faenas</caption>
          <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Fecha</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Tipo</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Producto</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Faena</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">Cantidad</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-24">Saldo</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Observación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {movements.map((m) => (
              <tr key={m.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                <td className="px-4 py-2.5 text-xs text-[var(--color-text-subtle)] whitespace-nowrap">
                  {formatDate(m.performedAt)}
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                  {MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                </td>
                <td className="px-4 py-2.5 text-sm text-[var(--color-text)]">
                  {m.product?.name ?? m.productId}
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                  {m.worksite?.name ?? m.worksiteId}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums text-sm ${MOVEMENT_QTY_CLASS[m.type] ?? "text-[var(--color-text-muted)]"}`}>
                  {m.quantity > 0 ? "+" : ""}{m.quantity}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-sm text-[var(--color-text-muted)]">
                  {m.stockAfter}
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--color-text-subtle)] truncate max-w-[200px]">
                  {m.reason ?? m.notes ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
