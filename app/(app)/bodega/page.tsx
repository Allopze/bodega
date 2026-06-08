import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db }       from "@/db"
import { deliveryItems, purchaseRequestItems, warehouses, worksites } from "@/db/schema"
import { eq, asc, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
import { DispatchPanel } from "./dispatch-panel"
import { formatQty, formatDate } from "@/lib/utils"
import type { DeliverableOption, StockOption, WorksiteOption } from "./dispatch-panel"

export const metadata: Metadata = { title: "Bodega" }

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:          "Ingreso OC",
  egreso_faena:        "Entrega faena",
  transferencia:       "Transferencia",
  devolucion:          "Devolución",
  ajuste_positivo:     "Ajuste (+)",
  ajuste_negativo:     "Ajuste (−)",
  rechazo:             "Rechazo",
  merma:               "Merma",
  anulacion:           "Anulación",
}

const MOVEMENT_QTY_CLASS: Record<string, string> = {
  ingreso_oc:         "text-[var(--color-success)] font-medium",
  egreso_faena:       "text-[var(--color-danger)]",
  ajuste_positivo:    "text-[var(--color-success)]",
  ajuste_negativo:    "text-[var(--color-danger)]",
  devolucion:         "text-[var(--color-success)]",
  rechazo:            "text-[var(--color-danger)]",
  merma:              "text-[var(--color-danger)]",
}

export default async function BodegaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect("/dashboard") }
  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""
  const requestedItemId = typeof sp.item === "string" ? sp.item : ""

  const canDispatch = can(session, "warehouse:register_movement")

  // Load all warehouses
  const [allWarehouses, allWorksites] = await Promise.all([
    db
      .select()
      .from(warehouses)
      .where(eq(warehouses.isActive, true))
      .orderBy(asc(warehouses.name)),
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
  ])

  if (allWarehouses.length === 0) {
    return (
      <>
        <PageHeader
          title="Bodega"
          description="Control de stock e inventario."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Bodega" },
            ]} />
          }
        />
        <EmptyState
          icon={<Warehouse size={24} />}
          title="Sin bodegas configuradas"
          description="Configura las bodegas en el módulo de administración para ver el stock aquí."
        />
      </>
    )
  }

  const warehouseIds = allWarehouses.map((w) => w.id)

  // Stock + recent movements in parallel
  const [stockRows, recentMovements, receivedItems] = await Promise.all([
    db.query.warehouseStock.findMany({
      where: (s, { inArray }) => inArray(s.warehouseId, warehouseIds),
      with:  { product: true, warehouse: true },
      orderBy: (s, { asc }) => [asc(s.warehouseId)],
    }),
    db.query.inventoryMovements.findMany({
      where: (m, { inArray }) => inArray(m.warehouseId, warehouseIds),
      with:  { product: true, warehouse: true },
      orderBy: (m, { desc }) => [desc(m.performedAt)],
      limit: 50,
    }),
    db.query.purchaseRequestItems.findMany({
      where: inArray(purchaseRequestItems.status, ["received", "partially_delivered"]),
      with: {
        product: true,
        request: true,
      },
    }),
  ])

  // Build StockOptions for the dispatch panel
  const stockOptions: StockOption[] = stockRows
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      warehouseId:   s.warehouseId,
      warehouseName: s.warehouse?.name ?? s.warehouseId,
      productId:     s.productId,
      productName:   s.product?.name ?? s.productId,
      productSku:    s.product?.sku ?? null,
      quantity:      s.quantity,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))
  const worksiteOptions: WorksiteOption[] = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({ id: w.id, name: w.name }))
  const requestItemIds = receivedItems.map((item) => item.id)
  const deliveredRows = requestItemIds.length > 0
    ? await db
        .select({ requestItemId: deliveryItems.requestItemId, quantity: deliveryItems.quantity })
        .from(deliveryItems)
        .where(inArray(deliveryItems.requestItemId, requestItemIds))
    : []
  const deliveredByItem = new Map<string, number>()
  for (const row of deliveredRows) {
    if (!row.requestItemId) continue
    deliveredByItem.set(row.requestItemId, (deliveredByItem.get(row.requestItemId) ?? 0) + row.quantity)
  }
  const deliverableOptions: DeliverableOption[] = receivedItems
    .filter((item) => item.productId !== null && canAccessWorksite(session, item.request.worksiteId))
    .map((item) => {
      const deliveredQuantity = deliveredByItem.get(item.id) ?? 0
      return {
        requestItemId: item.id,
        requestCode: item.request.code,
        worksiteId: item.request.worksiteId,
        productId: item.productId as string,
        productName: item.product?.name ?? item.productNameFree ?? "Ítem recibido",
        quantity: item.quantity,
        deliveredQuantity,
        remainingQuantity: Math.max(0, item.quantity - deliveredQuantity),
        unitOfMeasure: item.unitOfMeasure,
      }
    })
    .filter((item) => item.remainingQuantity > 0)
  const initialDeliverable = requestedItemId
    ? deliverableOptions.find((item) => item.requestItemId === requestedItemId)
    : undefined
  const initialWorksiteId = initialDeliverable?.worksiteId
    ?? (worksiteOptions.some((worksite) => worksite.id === requestedWorksiteId) ? requestedWorksiteId : undefined)
  const initialProductId = initialDeliverable?.productId
  const initialWarehouseId = initialProductId
    ? stockOptions.find((stock) => stock.productId === initialProductId)?.warehouseId
    : undefined

  // Group stock by warehouse
  const stockByWarehouse: Record<string, typeof stockRows> = {}
  for (const s of stockRows) {
    if (!stockByWarehouse[s.warehouseId]) stockByWarehouse[s.warehouseId] = []
    stockByWarehouse[s.warehouseId].push(s)
  }

  return (
    <>
      <PageHeader
        title="Bodega"
        description="Stock por producto y kardex de movimientos."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Bodega" },
          ]} />
        }
      />

      <div className="flex flex-col gap-8">
        {/* Stock tables per warehouse */}
        {allWarehouses.map((warehouse) => {
          const items = stockByWarehouse[warehouse.id] ?? []
          return (
            <div key={warehouse.id}>
              <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">
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
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                          Producto
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-32">
                          Stock
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-32">
                          Disponible
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-40">
                          Último mov.
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {items.map((s) => {
                        const unit      = s.product?.unitOfMeasure ?? "u"
                        const lowStock  = s.minStock > 0 && s.quantity <= s.minStock

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
                                  <span className="text-[10px] font-medium text-[oklch(0.62_0.15_56)] bg-[var(--color-signal-50)] border border-[var(--color-signal-100)] px-1.5 py-0.5 rounded">
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
        })}

        {/* Dispatch panel */}
        {canDispatch && stockOptions.length > 0 && worksiteOptions.length > 0 && (
          <div className="max-w-2xl">
            <DispatchPanel
              stockItems={stockOptions}
              worksites={worksiteOptions}
              deliverableItems={deliverableOptions}
              initialWarehouseId={initialWarehouseId}
              initialWorksiteId={initialWorksiteId}
              initialProductId={initialProductId}
              initialRequestItemId={initialDeliverable?.requestItemId}
            />
          </div>
        )}

        {/* Kardex — recent movements */}
        {recentMovements.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">
              Kardex: últimos 50 movimientos
            </h2>
            <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                      Fecha
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                      Tipo
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                      Producto
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                      Bodega
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">
                      Cantidad
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-24">
                      Saldo
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                      Observación
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {recentMovements.map((m) => (
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
                        {m.warehouse?.name ?? m.warehouseId}
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
        )}
      </div>
    </>
  )
}
