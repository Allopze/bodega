import type { Metadata } from "next"
import type { Session } from "next-auth"
import { auth } from "@/lib/auth/auth"
import { PageHeader } from "@/components/ui/page-header"
import { db } from "@/db"
import { invoiceAttachments, purchaseRequestItems, purchaseRequests, purchaseOrders } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { canAccessWorksite } from "@/lib/auth/can"
import {
  ClipboardText, CheckSquare, ShoppingCart, WarningCircle, Package,
} from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Dashboard" }

type MetricKey =
  | "my_requests"
  | "pending_approvals"
  | "approved_without_oc"
  | "orders_in_progress"
  | "orders_pending_receipt"
  | "invoice_pending"

type DashboardCard = {
  key: MetricKey
  title: string
  description: string
  icon: React.FC<{ size: number; className?: string }>
}

const PENDING_CARDS: Record<string, DashboardCard[]> = {
  solicitante_faena: [
    { key: "my_requests", title: "Mis solicitudes de faena", description: "Pedidos creados para tus faenas asignadas", icon: ClipboardText },
  ],
  jefa_chome: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare },
    { key: "approved_without_oc", title: "Ítems aprobados sin OC", description: "Ítems listos para compra", icon: WarningCircle },
    { key: "orders_pending_receipt", title: "OC pendientes de recepción", description: "Compras enviadas que deben marcarse recibidas", icon: Package },
    { key: "invoice_pending", title: "Facturas pendientes", description: "OC recibidas sin factura conciliada", icon: ShoppingCart },
  ],
  secretaria: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare },
    { key: "approved_without_oc", title: "Ítems aprobados sin OC", description: "Ítems listos para compra", icon: ShoppingCart },
    { key: "orders_pending_receipt", title: "OC pendientes de recepción", description: "Compras enviadas que deben marcarse recibidas", icon: Package },
    { key: "invoice_pending", title: "Facturas pendientes", description: "OC recibidas sin factura conciliada", icon: ShoppingCart },
  ],
  prevencionista: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare },
  ],
  administrador: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare },
    { key: "approved_without_oc", title: "Ítems aprobados sin OC", description: "Ítems listos para compra", icon: WarningCircle },
    { key: "orders_pending_receipt", title: "OC pendientes de recepción", description: "Compras enviadas que deben marcarse recibidas", icon: Package },
    { key: "invoice_pending", title: "Facturas pendientes", description: "OC recibidas sin factura conciliada", icon: ShoppingCart },
  ],
}

export default async function DashboardPage() {
  const session = await auth()
  const primaryRole = session?.user.roles?.[0] ?? "solicitante_faena"
  const cards = PENDING_CARDS[primaryRole] ?? PENDING_CARDS.solicitante_faena
  const metrics = session ? await getDashboardMetrics(session) : null

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Bienvenido, ${session?.user.name?.split(" ")[0] ?? "usuario"}`}
      />

      <div className="grid gap-px bg-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
        {cards.map(({ key, title, description, icon: Icon }) => (
          <div key={title} className="bg-[var(--color-surface)] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
                <Icon size={16} className="text-[var(--color-text-subtle)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
              </div>
              <div className="ml-auto font-mono text-lg font-semibold text-[var(--color-text-subtle)]">
                {metrics?.[key] ?? 0}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

async function getDashboardMetrics(session: Session): Promise<Record<MetricKey, number>> {
  const [requestRows, pendingItemRows, orderRows, invoiceRows] = await Promise.all([
    db
      .select({
        id: purchaseRequests.id,
        requesterId: purchaseRequests.requesterId,
        worksiteId: purchaseRequests.worksiteId,
        status: purchaseRequests.status,
      })
      .from(purchaseRequests),

    db
      .select({
        id: purchaseRequestItems.id,
        status: purchaseRequestItems.status,
        worksiteId: purchaseRequests.worksiteId,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(inArray(purchaseRequestItems.status, ["requested", "approved", "pending_purchase"])),

    db
      .select({
        id: purchaseOrders.id,
        worksiteId: purchaseOrders.worksiteId,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders),

    db
      .select({
        targetId: invoiceAttachments.targetId,
        targetType: invoiceAttachments.targetType,
        status: invoiceAttachments.status,
      })
      .from(invoiceAttachments),
  ])

  const visibleRequests = requestRows.filter((r) => canAccessWorksite(session, r.worksiteId))
  const visibleItems = pendingItemRows.filter((i) => canAccessWorksite(session, i.worksiteId))
  const visibleOrders = orderRows.filter((o) => canAccessWorksite(session, o.worksiteId))
  const visibleOrderIds = new Set(visibleOrders.map((order) => order.id))
  const invoiceRowsByOrder = invoiceRows.filter((invoice) =>
    invoice.targetType === "purchase_order" && visibleOrderIds.has(invoice.targetId)
  )
  const ordersWithReconciledInvoice = new Set(
    invoiceRowsByOrder
      .filter((invoice) => invoice.status === "reconciled")
      .map((invoice) => invoice.targetId),
  )
  const invoicesNeedingReview = invoiceRowsByOrder.filter((invoice) => invoice.status !== "reconciled").length
  const receivedOrdersWithoutReconciledInvoice = visibleOrders.filter((order) =>
    order.status === "received" && !ordersWithReconciledInvoice.has(order.id)
  ).length

  return {
    my_requests: visibleRequests.filter((r) => r.requesterId === session.user.id && r.status !== "cancelled").length,
    pending_approvals: visibleItems.filter((i) => i.status === "requested").length,
    approved_without_oc: visibleItems.filter((i) => i.status === "approved" || i.status === "pending_purchase").length,
    orders_in_progress: visibleOrders.filter((o) => ["issued", "sent", "supplier_confirmed", "partially_received"].includes(o.status)).length,
    orders_pending_receipt: visibleOrders.filter((o) => o.status === "sent" || o.status === "partially_received").length,
    invoice_pending: receivedOrdersWithoutReconciledInvoice + invoicesNeedingReview,
  }
}
