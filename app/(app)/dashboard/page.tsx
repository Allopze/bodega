import type { Metadata } from "next"
import type { Session } from "next-auth"
import Link from "next/link"
import { auth } from "@/lib/auth/auth"
import { PageHeader } from "@/components/ui/page-header"
import { db } from "@/db"
import { invoiceAttachments, purchaseRequestItems, purchaseRequests, purchaseOrders, worksites } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { canAccessWorksite } from "@/lib/auth/can"
import { cn } from "@/lib/utils"
import {
  ClipboardText, CheckSquare, ShoppingCart, WarningCircle, Package,
  Coins, FileText, CheckCircle,
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
  href: string
}

const PENDING_CARDS: Record<string, DashboardCard[]> = {
  solicitante_faena: [
    { key: "my_requests", title: "Mis solicitudes de faena", description: "Pedidos creados para tus faenas asignadas", icon: ClipboardText, href: "/solicitudes" },
  ],
  jefa_chome: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare, href: "/aprobaciones" },
    { key: "approved_without_oc", title: "Ítems aprobados sin OC", description: "Ítems listos para compra", icon: WarningCircle, href: "/compras/nueva" },
    { key: "orders_pending_receipt", title: "OC pendientes de recepción", description: "Compras enviadas que deben marcarse recibidas", icon: Package, href: "/recepcion" },
    { key: "invoice_pending", title: "Facturas pendientes", description: "OC recibidas sin factura conciliada", icon: ShoppingCart, href: "/reportes" },
  ],
  secretaria: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare, href: "/aprobaciones" },
    { key: "approved_without_oc", title: "Ítems aprobados sin OC", description: "Ítems listos para compra", icon: ShoppingCart, href: "/compras/nueva" },
    { key: "orders_pending_receipt", title: "OC pendientes de recepción", description: "Compras enviadas que deben marcarse recibidas", icon: Package, href: "/recepcion" },
    { key: "invoice_pending", title: "Facturas pendientes", description: "OC recibidas sin factura conciliada", icon: ShoppingCart, href: "/reportes" },
  ],
  prevencionista: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare, href: "/aprobaciones" },
  ],
  administrador: [
    { key: "pending_approvals", title: "Pendientes de aprobación", description: "Solicitudes esperando revisión", icon: CheckSquare, href: "/aprobaciones" },
    { key: "approved_without_oc", title: "Ítems aprobados sin OC", description: "Ítems listos para compra", icon: WarningCircle, href: "/compras/nueva" },
    { key: "orders_pending_receipt", title: "OC pendientes de recepción", description: "Compras enviadas que deben marcarse recibidas", icon: Package, href: "/recepcion" },
    { key: "invoice_pending", title: "Facturas pendientes", description: "OC recibidas sin factura conciliada", icon: ShoppingCart, href: "/reportes" },
  ],
}

const CARD_STYLES: Record<MetricKey, { bg: string; border: string; text: string; textActive: string; iconColor: string; iconBg: string }> = {
  my_requests: {
    bg: "bg-[var(--color-primary-50)]",
    border: "border-[var(--color-primary-100)]",
    text: "text-[var(--color-text-subtle)]",
    textActive: "text-[var(--color-primary)] font-bold",
    iconColor: "text-[var(--color-primary)]",
    iconBg: "bg-[var(--color-primary-100)]",
  },
  pending_approvals: {
    bg: "bg-[oklch(0.975_0.02_90)]",
    border: "border-[oklch(0.948_0.042_90)]",
    text: "text-[var(--color-text-subtle)]",
    textActive: "text-[oklch(0.52_0.11_85)] font-bold",
    iconColor: "text-[oklch(0.52_0.11_85)]",
    iconBg: "bg-[oklch(0.948_0.042_90)]",
  },
  approved_without_oc: {
    bg: "bg-[var(--color-primary-50)]",
    border: "border-[var(--color-primary-100)]",
    text: "text-[var(--color-text-subtle)]",
    textActive: "text-[var(--color-primary)] font-bold",
    iconColor: "text-[var(--color-primary)]",
    iconBg: "bg-[var(--color-primary-100)]",
  },
  orders_in_progress: {
    bg: "bg-[oklch(0.966_0.014_250)]",
    border: "border-[oklch(0.924_0.03_250)]",
    text: "text-[var(--color-text-subtle)]",
    textActive: "text-[oklch(0.4_0.115_248)] font-bold",
    iconColor: "text-[oklch(0.4_0.115_248)]",
    iconBg: "bg-[oklch(0.924_0.03_250)]",
  },
  orders_pending_receipt: {
    bg: "bg-[oklch(0.966_0.014_250)]",
    border: "border-[oklch(0.924_0.03_250)]",
    text: "text-[var(--color-text-subtle)]",
    textActive: "text-[oklch(0.4_0.115_248)] font-bold",
    iconColor: "text-[oklch(0.4_0.115_248)]",
    iconBg: "bg-[oklch(0.924_0.03_250)]",
  },
  invoice_pending: {
    bg: "bg-[oklch(0.97_0.018_25)]",
    border: "border-[oklch(0.934_0.04_25)]",
    text: "text-[var(--color-text-subtle)]",
    textActive: "text-[oklch(0.42_0.16_25)] font-bold",
    iconColor: "text-[oklch(0.42_0.16_25)]",
    iconBg: "bg-[oklch(0.934_0.04_25)]",
  },
}

function formatCLP(amount: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  }).format(amount)
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session) return null
  
  const primaryRole = session.user.roles?.[0] ?? "solicitante_faena"
  const cards = PENDING_CARDS[primaryRole] ?? PENDING_CARDS.solicitante_faena
  const data = await getDashboardData(session)

  const approvalRate = data.summary.totalRequests > 0 
    ? Math.round((data.summary.approvedRequests / data.summary.totalRequests) * 100)
    : 0

  return (
    <div className="space-y-8 animate-in fade-in duration-[var(--duration-default)]">
      <PageHeader
        title="Dashboard"
        description={`Bienvenido, ${session.user.name?.split(" ")[0] ?? "usuario"}`}
      />

      {/* ── KPI Resumen Rápido (Sección Superior) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Costos Totales */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 flex items-center gap-4 shadow-[var(--shadow-sm)]">
          <div className="h-10 w-10 rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary)] flex items-center justify-center shrink-0">
            <Coins size={22} weight="fill" />
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)] font-medium">Inversión en OC Emitidas</p>
            <p className="text-xl font-bold text-[var(--color-text)] mt-0.5">{formatCLP(data.summary.totalCosts)}</p>
          </div>
        </div>

        {/* Solicitudes Totales */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 flex items-center gap-4 shadow-[var(--shadow-sm)]">
          <div className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <FileText size={22} weight="fill" />
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)] font-medium">Solicitudes Visibles</p>
            <p className="text-xl font-bold text-[var(--color-text)] mt-0.5">{data.summary.totalRequests}</p>
          </div>
        </div>

        {/* Tasa de Aprobación */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 flex items-center gap-4 shadow-[var(--shadow-sm)]">
          <div className="h-10 w-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle size={22} weight="fill" />
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)] font-medium">Tasa de Aprobación</p>
            <p className="text-xl font-bold text-[var(--color-text)] mt-0.5">{approvalRate}%</p>
          </div>
        </div>
      </div>

      {/* ── Rejilla de Pendientes (Grid Compacta de Tarjetas) ── */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-4">Tareas y Alertas Pendientes</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(({ key, title, description, icon: Icon, href }) => {
            const value = data.metrics[key] ?? 0
            const style = CARD_STYLES[key] ?? CARD_STYLES.my_requests
            const hasPending = value > 0

            return (
              <Link
                href={href}
                key={title}
                className={cn(
                  "rounded-[var(--radius-lg)] border p-5 flex flex-col justify-between bg-[var(--color-surface)]",
                  "transition-[background-color,border-color,box-shadow,transform] duration-[var(--duration-default)] ease-[var(--ease-out)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                  hasPending ? `${style.bg} ${style.border}` : "border-[var(--color-border)] opacity-85",
                  "hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--color-primary)] active:scale-[0.99]"
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("p-2 rounded-[var(--radius)]", hasPending ? style.iconBg : "bg-[var(--color-surface-2)]")}>
                    <Icon size={18} className={hasPending ? style.iconColor : "text-[var(--color-text-subtle)]"} />
                  </div>
                  <div className={cn("text-2xl font-mono font-bold leading-none", hasPending ? style.textActive : "text-[var(--color-text-subtle)]")}>
                    {value}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[var(--color-text)]">{title}</h4>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{description}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Desglose de Actividad por Faena (Sección Inferior) ── */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6 shadow-[var(--shadow-sm)]">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-4">Actividad y Costos por Faena</h3>
        {data.worksitesBreakdown.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--color-text-subtle)]">No hay actividad registrada en las faenas visibles.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-semibold">
                  <th className="py-2.5 px-3">Faena</th>
                  <th className="py-2.5 px-3 text-right">Solicitudes</th>
                  <th className="py-2.5 px-3 text-right">Pendientes Aprob.</th>
                  <th className="py-2.5 px-3 text-right">Aprobadas</th>
                  <th className="py-2.5 px-3 text-right">Total OC Emitidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.worksitesBreakdown.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-surface-2)] transition-colors">
                    <td className="py-3 px-3 font-medium text-[var(--color-text)]">{row.name}</td>
                    <td className="py-3 px-3 text-right font-mono">{row.requestsCount}</td>
                    <td className="py-3 px-3 text-right font-mono">
                      <span className={cn(row.pendingCount > 0 ? "text-[oklch(0.52_0.11_85)] font-bold" : "text-[var(--color-text-subtle)]")}>
                        {row.pendingCount}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono">{row.approvedCount}</td>
                    <td className="py-3 px-3 text-right font-mono font-medium text-[var(--color-text)]">
                      {formatCLP(row.totalCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

async function getDashboardData(session: Session) {
  const [requestRows, pendingItemRows, orderRows, invoiceRows, worksiteRows] = await Promise.all([
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
        totalAmount: purchaseOrders.totalAmount,
      })
      .from(purchaseOrders),

    db
      .select({
        targetId: invoiceAttachments.targetId,
        targetType: invoiceAttachments.targetType,
        status: invoiceAttachments.status,
      })
      .from(invoiceAttachments),

    db
      .select({
        id: worksites.id,
        name: worksites.name,
        isActive: worksites.isActive,
      })
      .from(worksites)
      .where(eq(worksites.isActive, true)),
  ])

  // Filter rows based on user worksite permissions
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

  const metrics: Record<MetricKey, number> = {
    my_requests: visibleRequests.filter((r) => r.requesterId === session.user.id && r.status !== "cancelled").length,
    pending_approvals: visibleItems.filter((i) => i.status === "requested").length,
    approved_without_oc: visibleItems.filter((i) => i.status === "approved" || i.status === "pending_purchase").length,
    orders_in_progress: visibleOrders.filter((o) => ["issued", "sent", "supplier_confirmed", "partially_received"].includes(o.status)).length,
    orders_pending_receipt: visibleOrders.filter((o) => o.status === "sent" || o.status === "partially_received").length,
    invoice_pending: receivedOrdersWithoutReconciledInvoice + invoicesNeedingReview,
  }

  // Summary KPIs
  const totalCosts = visibleOrders
    .filter((o) => o.status !== "cancelled" && o.status !== "draft")
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0)
  
  const totalRequests = visibleRequests.length
  const approvedRequests = visibleRequests.filter((r) => 
    ["approved", "closed", "in_purchasing"].includes(r.status)
  ).length

  // Worksites breakdown
  const visibleWorksites = worksiteRows.filter((w) => canAccessWorksite(session, w.id))
  const worksitesBreakdown = visibleWorksites
    .map((w) => {
      const requests = visibleRequests.filter((r) => r.worksiteId === w.id)
      const orders = visibleOrders.filter((o) => o.worksiteId === w.id && o.status !== "cancelled" && o.status !== "draft")
      const items = visibleItems.filter((i) => i.worksiteId === w.id)

      const requestsCount = requests.length
      const pendingCount = items.filter((i) => i.status === "requested").length
      const approvedCount = requests.filter((r) => ["approved", "closed", "in_purchasing"].includes(r.status)).length
      const totalCost = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0)

      return {
        id: w.id,
        name: w.name,
        requestsCount,
        pendingCount,
        approvedCount,
        totalCost,
      }
    })
    .filter((w) => w.requestsCount > 0 || w.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost) // sort by cost descending

  return {
    metrics,
    summary: {
      totalCosts,
      totalRequests,
      approvedRequests,
    },
    worksitesBreakdown,
  }
}
