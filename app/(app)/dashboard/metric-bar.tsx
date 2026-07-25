import type { Session } from "next-auth"
import { canAny } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { formatCLP } from "@/lib/utils"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import {
  ChartLineUp,
  CheckCircle,
  CheckSquare,
  Coins,
  HardHat,
  ShoppingCart,
  Truck,
  Warehouse,
  Warning,
} from "@phosphor-icons/react/dist/ssr"

interface MetricBarProps {
  session:              Session
  pendingTasks:         number
  criticalTasks:        number
  pendingApprovals:     number
  approvedWithoutOc:    number
  ordersPendingReceipt: number
  deliveryTasks:        number
  stockAlerts:          number
  eppGaps?:             number
  totalCosts:           number
  approvalRate:         number
}

/**
 * Tira editorial de métricas del dashboard. Arma el array de stats, filtra por
 * permiso del usuario y delega el render a `SummaryBar` (superficie canónica).
 * La lógica de permisos y formato vive aquí (call site); `SummaryBar` solo renderiza.
 */
export function MetricBar({
  session,
  pendingTasks,
  criticalTasks,
  pendingApprovals,
  approvedWithoutOc,
  ordersPendingReceipt,
  deliveryTasks,
  stockAlerts,
  eppGaps,
  totalCosts,
  approvalRate,
}: MetricBarProps) {
  type Stat = SummaryStat & { permissions?: Permission[] }

  const allStats: Stat[] = [
    { key: "tasks",      label: "Tareas",        value: pendingTasks,         icon: <CheckCircle size={13} weight="bold" />, tone: "signal", hint: criticalTasks > 0 ? `${criticalTasks} crít.` : undefined },
    { key: "approvals",  label: "Por aprobar",   value: pendingApprovals,     icon: <CheckSquare size={13} />, href: "/aprobaciones",  permissions: ["approvals:approve"] },
    { key: "no-oc",      label: "Sin OC",        value: approvedWithoutOc,    icon: <ShoppingCart size={13} />, href: "/compras/nueva", permissions: ["purchasing:create_order"] },
    { key: "to-receive", label: "Por recibir",   value: ordersPendingReceipt, icon: <Truck size={13} />, href: "/recepcion",      permissions: ["receiving:view"] },
    { key: "deliveries", label: "Entregas",      value: deliveryTasks,        icon: <Warehouse size={13} />, href: "/entregas",      permissions: ["warehouse:register_movement"] },
    { key: "stock",      label: "Alertas stock", value: stockAlerts,          icon: <Warning size={13} />, href: "/bodega",         permissions: ["warehouse:view_stock"], tone: "signal" },
    { key: "epp-gaps",   label: "Brechas EPP",   value: eppGaps ?? 0,         icon: <HardHat size={13} />, href: "/prevencion/epp-preventivo", permissions: ["prevention:epp:view"], tone: "signal" },
    { key: "investment", label: "Inversión",     value: formatCLP(totalCosts),icon: <Coins size={13} />, permissions: ["purchasing:view", "reports:view"] },
    { key: "rate",       label: "Tasa aprob.",   value: `${approvalRate}%`,   icon: <ChartLineUp size={13} />, permissions: ["approvals:approve", "reports:view"], progress: approvalRate },
  ]

  const stats: SummaryStat[] = allStats
    .filter((stat) => !stat.permissions || stat.permissions.length === 0 || canAny(session, ...stat.permissions))
    .map(({ permissions: _permissions, ...rest }) => rest)

  return <SummaryBar stats={stats} />
}
