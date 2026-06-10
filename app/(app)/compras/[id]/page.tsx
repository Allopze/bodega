import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db }                  from "@/db"
import { purchaseOrders, statusHistory, users } from "@/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite }  from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { StateBadge } from "@/components/states/state-badge"
import { OcActions } from "./oc-actions"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { EntityTimeline } from "@/components/states/entity-timeline"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Orden de compra" }

export default async function OcDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect("/dashboard") }

  const { id } = await params

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      items:    { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      worksite: true,
      supplier: true,
    },
  })

  if (!order) notFound()
  if (!canAccessWorksite(session, order.worksiteId)) notFound()

  // Load linked request items + request codes for traceability
  const requestItemIds = order.items
    .map((i) => i.requestItemId)
    .filter((id): id is string => id !== null)

  const productIds = order.items
    .map((i) => i.productId)
    .filter((id): id is string => id !== null)

  const [requestItemRows, productRows, timelineEvents] = await Promise.all([
    requestItemIds.length > 0
      ? db.query.purchaseRequestItems.findMany({
          where: (ri, { inArray }) => inArray(ri.id, requestItemIds),
          with: { request: true },
        })
      : Promise.resolve([]),

    productIds.length > 0
      ? db.query.products.findMany({
          where: (p, { inArray }) => inArray(p.id, productIds),
          columns: { id: true, sku: true, name: true },
        })
      : Promise.resolve([]),

    db
      .select({
        id:          statusHistory.id,
        fromStatus:  statusHistory.fromStatus,
        toStatus:    statusHistory.toStatus,
        changedBy:   statusHistory.changedBy,
        changedAt:   statusHistory.changedAt,
        reason:      statusHistory.reason,
        userName:    users.name,
        userEmail:   users.email,
      })
      .from(statusHistory)
      .leftJoin(users, eq(statusHistory.changedBy, users.id))
      .where(
        and(
          eq(statusHistory.entityType, "purchase_order"),
          eq(statusHistory.entityId, order.id),
        ),
      )
      .orderBy(desc(statusHistory.changedAt)),
  ])

  // Build maps
  const reqItemMap = Object.fromEntries(requestItemRows.map((ri) => [ri.id, ri]))
  const productMap = Object.fromEntries(productRows.map((p) => [p.id, p]))

  const canManage = session.user.permissions.includes("purchasing:create_order")
  const canSend   = session.user.permissions.includes("purchasing:send_order")

  return (
    <>
      <PageHeader
        title={order.code}
        description={`${order.worksite?.name ?? "—"} · ${order.supplier?.name ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <StateBadge state={order.status} entity="oc" />
            <Button asChild variant="secondary" size="sm">
              <a
                href={`/compras/${order.id}/print`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Imprimir / PDF
              </a>
            </Button>
          </div>
        }
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Compras",   href: "/compras"   },
            { label: order.code                       },
          ]} />
        }
      />

      <div className="max-w-3xl flex flex-col gap-6">
        {/* OC header summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border border-[var(--color-border)] rounded-[var(--radius-lg)] bg-[var(--color-surface-2)]">
          <div>
            <p className="text-xs text-[var(--color-text-subtle)] mb-0.5">Proveedor</p>
            <p className="text-sm font-medium text-[var(--color-text)]">{order.supplier?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-subtle)] mb-0.5">Condición de pago</p>
            <p className="text-sm text-[var(--color-text-muted)]">{order.paymentTerms ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-subtle)] mb-0.5">Entrega estimada</p>
            <p className="text-sm text-[var(--color-text-muted)]">
              {order.estimatedDelivery ? formatDate(order.estimatedDelivery) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-subtle)] mb-0.5">Total</p>
            <p className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
              {formatCLP(order.totalAmount)}
            </p>
          </div>
        </div>

        {/* Items */}
        <div className="grid gap-2 md:hidden">
          {order.items.map((item) => {
            const reqItem  = item.requestItemId ? reqItemMap[item.requestItemId] : null
            const product  = item.productId ? productMap[item.productId] : null
            const name     = product?.name ?? item.productNameFree ?? "(sin nombre)"
            const sku      = product?.sku ?? null
            const reqCode  = (reqItem as { request?: { code: string } } | null)?.request?.code

            return (
              <article key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
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

          <dl className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
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

        <div className="hidden overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] md:block">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Producto
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-24">
                  Cant.
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">
                  Precio unit.
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] w-28">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {order.items.map((item) => {
                const reqItem  = item.requestItemId ? reqItemMap[item.requestItemId] : null
                const product  = item.productId ? productMap[item.productId] : null
                const name     = product?.name ?? item.productNameFree ?? "(sin nombre)"
                const sku      = product?.sku ?? null
                const reqCode  = (reqItem as { request?: { code: string } } | null)?.request?.code

                return (
                  <tr key={item.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {sku && (
                          <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                            {sku}
                          </span>
                        )}
                        <span className="font-medium text-[var(--color-text)]">{name}</span>
                      </div>
                      {reqCode && (
                        <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">
                          Solicitud: {reqCode}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-xs text-[var(--color-text-subtle)] italic mt-0.5">
                          {item.notes}
                        </p>
                      )}
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
            <tfoot className="bg-[var(--color-surface-2)] border-t border-[var(--color-border)]">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-xs text-right text-[var(--color-text-muted)]">
                  Neto
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-sm text-[var(--color-text-muted)]">
                  {formatCLP(order.netAmount)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 py-1 text-xs text-right text-[var(--color-text-subtle)]">
                  IVA (19%)
                </td>
                <td className="px-4 py-1 text-right tabular-nums text-sm text-[var(--color-text-subtle)]">
                  {formatCLP(order.taxAmount)}
                </td>
              </tr>
              <tr className="border-t border-[var(--color-border)]">
                <td colSpan={3} className="px-4 py-2.5 text-sm font-semibold text-right text-[var(--color-text)]">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-sm font-bold text-[var(--color-text)]">
                  {formatCLP(order.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius)] bg-[var(--color-surface-2)]">
            <p className="text-xs text-[var(--color-text-subtle)] mb-1">Notas</p>
            <p className="text-sm text-[var(--color-text-muted)]">{order.notes}</p>
          </div>
        )}

        {/* Actions (issue/send) */}
        {(canManage || canSend) && (
          <OcActions
            orderId={order.id}
            status={order.status}
            canManage={canManage}
            canSend={canSend}
          />
        )}

        <EntityTimeline entityType="oc" events={timelineEvents} />
      </div>
    </>
  )
}
