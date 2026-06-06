import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db }       from "@/db"
import { warehouses } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { DispatchPanel } from "./dispatch-panel"
import { formatQty, formatDate } from "@/lib/utils"
import type { StockOption } from "./dispatch-panel"

export const metadata: Metadata = { title: "Bodega" }

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ingreso_oc:          "Ingreso OC",
  egreso_faena:        "Despacho faena",
  entrega_trabajador:  "Entrega trabajador",
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
  entrega_trabajador: "text-[var(--color-danger)]",
  ajuste_positivo:    "text-[var(--color-success)]",
  ajuste_negativo:    "text-[var(--color-danger)]",
  devolucion:         "text-[var(--color-success)]",
  rechazo:            "text-[var(--color-danger)]",
  merma:              "text-[var(--color-danger)]",
}

export default async function BodegaPage() {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect("/dashboard") }

  const canDispatch = can(session, "warehouse:register_movement")

  // Load all warehouses
  const allWarehouses = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(asc(warehouses.name))

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
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-[var(--color-text)]">Sin bodegas configuradas</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Configura las bodegas en el módulo de administración.
          </p>
        </div>
      </>
    )
  }

  const warehouseIds = allWarehouses.map((w) => w.id)

  // Stock + recent movements in parallel
  const [stockRows, recentMovements] = await Promise.all([
    db.query.warehouseStock.findMany({
      where: (s, { inArray }) => inArray(s.warehouseId, warehouseIds),
      with:  { product: true, warehouse: true },
      orderBy: (s, { asc }) => [asc(s.warehouseId)],
    }),
    db.query.inventoryMovements.findMany({
      where: (m, { inArray }) => inArray(m.warehouseId, warehouseIds),
      with:  { product: true, warehouse: true },
      orderBy: (m, { desc }) => [desc(m.performedAt)],
    }).then((rows) => rows.slice(0, 50)),
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
                <p className="text-sm text-[var(--color-text-subtle)] py-4 px-1">
                  Sin movimientos aún. Los ingresos de OC aparecerán aquí.
                </p>
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
                          Reservado
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
                        const available = s.quantity - (s.reservedQty ?? 0)
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
                            <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-subtle)]">
                              {formatQty(s.reservedQty ?? 0, unit)}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums font-medium ${available <= 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text)]"}`}>
                              {formatQty(available, unit)}
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
        {canDispatch && stockOptions.length > 0 && (
          <div className="max-w-2xl">
            <DispatchPanel stockItems={stockOptions} />
          </div>
        )}

        {/* Kardex — recent movements */}
        {recentMovements.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">
              Kardex — últimos 50 movimientos
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
