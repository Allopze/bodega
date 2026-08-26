import { countOf, formatCLP, formatDateTime, formatQty } from "@/lib/utils"
import { OcItemCostForm } from "./oc-item-cost-form"
import type { OcDetailItem, OcDetailOrder } from "./oc-detail.types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

function formatLineAmount(amount: number | null) {
  return amount === null ? "Costo pendiente" : formatCLP(amount)
}

/**
 * Instrumento y colaborador del ítem de origen. La OC de una mantención tiene
 * que decir sobre qué aparato es: desde que el equipo pasó a ser una FK, dejó
 * de viajar como atributo de texto y la ficha se quedó sin ese dato.
 */
function ItemContext({ item }: { item: OcDetailItem }) {
  if (!item.equipmentLabel && !item.workerName) return null
  return (
    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
      {[
        item.equipmentLabel ? `Equipo: ${item.equipmentLabel}` : null,
        item.workerName ? `Colaborador: ${item.workerName}` : null,
      ].filter(Boolean).join(" · ")}
    </p>
  )
}

/** Traza del costo que se registró después de emitir la orden. */
function CostTrace({ item }: { item: OcDetailItem }) {
  if (!item.costRecordedAt) return null
  return (
    <p className="mt-0.5 text-[11px] text-[var(--color-text-subtle)]">
      Costo registrado el {formatDateTime(item.costRecordedAt)}
      {item.costRecordedByName ? ` por ${item.costRecordedByName}` : ""}
    </p>
  )
}

export function OcDetailItems({
  order,
  reqItemMap,
  productMap,
  canRecordCost = false,
}: {
  order: OcDetailOrder
  reqItemMap: Record<string, { request: { code: string } }>
  productMap: Record<string, { name: string; sku: string | null }>
  /** `purchasing:create_order` — quien pone precio al crear la OC lo pone después. */
  canRecordCost?: boolean
}) {
  const pendingCostLines = order.items.filter((item) => item.unitPrice === null).length

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
              <ItemContext item={item} />
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
                  <dd className="font-mono tabular-nums text-[var(--color-text)]">{formatLineAmount(item.unitPrice)}</dd>
                </div>
                <div className="col-span-2 border-t border-[var(--color-border)] pt-2 text-right">
                  <dt className="text-[var(--color-text-subtle)]">Subtotal</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">
                    {formatLineAmount(item.subtotal)}
                  </dd>
                </div>
              </dl>
              <CostTrace item={item} />
              {item.unitPrice === null && canRecordCost && (
                <OcItemCostForm
                  variant="mobile"
                  purchaseOrderItemId={item.id}
                  quantity={item.quantity}
                  unitOfMeasure={item.unitOfMeasure}
                />
              )}
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
            <dt className="font-semibold text-[var(--color-text)]">{pendingCostLines > 0 ? "Total conocido" : "Total"}</dt>
            <dd className="font-mono font-bold tabular-nums text-[var(--color-text)]">{formatCLP(order.totalAmount)}</dd>
          </div>
          {pendingCostLines > 0 && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <dt className="text-xs text-[var(--color-warning-ink)]">{countOf(pendingCostLines, "servicio")} con costo pendiente</dt>
              <dd className="text-xs text-[var(--color-warning-ink)]">por definir</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] bg-[var(--color-surface)] md:block">
        <TableRoot className="rounded-none border-0">
        <Table className="text-sm">
          <caption className="sr-only">Detalle de ítems de la orden de compra</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead><TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">Precio unit.</TableHead><TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => {
              const reqItem = item.requestItemId ? reqItemMap[item.requestItemId] : null
              const product = item.productId ? productMap[item.productId] : null
              const name    = product?.name ?? item.productNameFree ?? "(sin nombre)"
              const sku     = product?.sku ?? null
              const reqCode = reqItem?.request?.code

              return (
                <TableRow key={item.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {sku && (
                        <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">{sku}</span>
                      )}
                      <span className="font-medium text-[var(--color-text)]">{name}</span>
                    </div>
                    {reqCode && <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">Solicitud: {reqCode}</p>}
                    <ItemContext item={item} />
                    {item.notes && <p className="text-xs text-[var(--color-text-subtle)] italic mt-0.5">{item.notes}</p>}
                    <CostTrace item={item} />
                    {item.unitPrice === null && canRecordCost && (
                      <OcItemCostForm
                        variant="desktop"
                        purchaseOrderItemId={item.id}
                        quantity={item.quantity}
                        unitOfMeasure={item.unitOfMeasure}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[var(--color-text-muted)]">
                    {formatQty(item.quantity, item.unitOfMeasure)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[var(--color-text-muted)]">
                    {formatLineAmount(item.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-[var(--color-text)]">
                    {formatLineAmount(item.subtotal)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </TableRoot>
      </div>
    </>
  )
}
