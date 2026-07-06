import { formatCLP, formatQty } from "@/lib/utils"
import type { OcDetailOrder } from "./oc-detail.types"

export function OcDetailItems({
  order,
  reqItemMap,
  productMap,
}: {
  order: OcDetailOrder
  reqItemMap: Record<string, { request: { code: string } }>
  productMap: Record<string, { name: string; sku: string | null }>
}) {
  return (
    <>
      {/* Mobile cards */}
      <div className="grid gap-2 md:hidden">
        {order.items.map((item) => {
          const reqItem = item.requestItemId ? reqItemMap[item.requestItemId] : null
          const product = item.productId ? productMap[item.productId] : null
          const name    = product?.name ?? item.productNameFree ?? "(sin nombre)"
          const sku     = product?.sku ?? null
          const reqCode = reqItem?.request?.code

          return (
            <article key={item.id} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">{name}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  {sku ? <span className="font-mono">{sku} · </span> : null}
                  {reqCode ? `Solicitud ${reqCode}` : "Sin solicitud asociada"}
                </p>
              </div>
              {item.notes && (
                <p className="mt-2 text-xs italic text-[var(--color-text-subtle)]">{item.notes}</p>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Cantidad</dt>
                  <dd className="font-mono tabular-nums text-[var(--color-text)]">
                    {formatQty(item.quantity, item.unitOfMeasure)}
                  </dd>
                </div>
                <div className="text-right">
                  <dt className="text-[var(--color-text-subtle)]">Precio unit.</dt>
                  <dd className="font-mono tabular-nums text-[var(--color-text)]">{formatCLP(item.unitPrice)}</dd>
                </div>
                <div className="col-span-2 border-t border-[var(--color-border)] pt-2 text-right">
                  <dt className="text-[var(--color-text-subtle)]">Subtotal</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
                    {formatCLP(item.subtotal)}
                  </dd>
                </div>
              </dl>
            </article>
          )
        })}

        <dl className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 text-sm">
          <div className="flex items-center justify-between gap-3 py-1">
            <dt className="text-[var(--color-text-muted)]">Neto</dt>
            <dd className="font-mono tabular-nums text-[var(--color-text-muted)]">{formatCLP(order.netAmount)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-1">
            <dt className="text-[var(--color-text-subtle)]">IVA (19%)</dt>
            <dd className="font-mono tabular-nums text-[var(--color-text-subtle)]">{formatCLP(order.taxAmount)}</dd>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
            <dt className="font-semibold text-[var(--color-text)]">Total</dt>
            <dd className="font-mono font-bold tabular-nums text-[var(--color-text)]">{formatCLP(order.totalAmount)}</dd>
          </div>
        </dl>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] bg-[var(--color-surface)] md:block">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Producto</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-24">Cant.</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">Precio unit.</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {order.items.map((item) => {
              const reqItem = item.requestItemId ? reqItemMap[item.requestItemId] : null
              const product = item.productId ? productMap[item.productId] : null
              const name    = product?.name ?? item.productNameFree ?? "(sin nombre)"
              const sku     = product?.sku ?? null
              const reqCode = reqItem?.request?.code

              return (
                <tr key={item.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {sku && (
                        <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">{sku}</span>
                      )}
                      <span className="font-medium text-[var(--color-text)]">{name}</span>
                    </div>
                    {reqCode && <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">Solicitud: {reqCode}</p>}
                    {item.notes && <p className="text-xs text-[var(--color-text-subtle)] italic mt-0.5">{item.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                    {formatQty(item.quantity, item.unitOfMeasure)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                    {formatCLP(item.unitPrice)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--color-text)]">
                    {formatCLP(item.subtotal)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
