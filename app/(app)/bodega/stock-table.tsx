import type { Warehouse, WarehouseStockWithProduct } from "./types"
import { EmptyState } from "@/components/ui/empty-state"
import { formatQty, formatDate } from "@/lib/utils"

export interface StockTableProps {
  warehouse: Warehouse
  items: WarehouseStockWithProduct[]
}

export function StockTable({ warehouse, items }: StockTableProps) {
  return (
    <div>
      <h2 className="text-h2 mb-3">
        {warehouse.name}
        <span className="ml-2 text-xs font-mono text-[var(--color-text-subtle)] font-normal">
          {warehouse.code}
        </span>
      </h2>

      {items.length === 0 ? (
        <EmptyState
          title="Sin stock en esta bodega"
          description="Los ingresos de OC aparecerán aquí."
          compact
        />
      ) : (
        <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
          <table className="w-full text-sm" aria-label={`Stock en ${warehouse.name}`}>
            <caption className="sr-only">Productos y cantidades en bodega {warehouse.name}</caption>
            <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Producto</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-32">Stock</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-32">Disponible</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-40">Último mov.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.map((s) => {
                const unit = s.product?.unitOfMeasure ?? "u"
                const lowStock = s.minStock > 0 && s.quantity <= s.minStock

                return (
                  <tr key={s.id} className={`hover:bg-[var(--color-surface-2)] transition-colors ${lowStock ? "bg-[var(--color-signal-50)]" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {s.product?.sku && (
                          <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                            {s.product.sku}
                          </span>
                        )}
                        <span className="font-medium text-[var(--color-text)]">
                          {s.product?.name ?? s.productId}
                        </span>
                        {lowStock && (
                          <span className="text-[10px] font-medium text-[var(--color-signal-500)] bg-[var(--color-signal-50)] border border-[var(--color-signal-100)] px-1.5 py-0.5 rounded">
                            Stock bajo
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                      {formatQty(s.quantity, unit)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${s.quantity <= 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text)]"}`}>
                      {formatQty(s.quantity, unit)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[var(--color-text-subtle)]">
                      {s.lastMovementAt ? formatDate(s.lastMovementAt) : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
