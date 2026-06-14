import type { ComponentType } from "react"
import type { Session } from "next-auth"
import Link from "next/link"
import { can } from "@/lib/auth/can"
import type { Permission } from "@/lib/auth/types"
import { cn } from "@/lib/utils"
import {
  ChartBar,
  CheckSquare,
  ClipboardText,
  Package,
  ShoppingCart,
  Truck,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr"

type IconComponent = ComponentType<{ size: number; className?: string }>

interface ActionDef {
  key:        string
  label:      string
  href:       string
  permission: Permission
  Icon:       IconComponent
}

// Order doubles as priority: the first action the user can do becomes the
// filled primary pill; the rest render as ghost pills.
const ACTIONS: ActionDef[] = [
  { key: "new-request", label: "Nueva solicitud",      href: "/solicitudes/nueva", permission: "requests:create",             Icon: ClipboardText },
  { key: "approvals",   label: "Revisar aprobaciones", href: "/aprobaciones",      permission: "approvals:approve",           Icon: CheckSquare },
  { key: "new-oc",      label: "Emitir OC",            href: "/compras/nueva",     permission: "purchasing:create_order",     Icon: ShoppingCart },
  { key: "receiving",   label: "Recepción",            href: "/recepcion",         permission: "receiving:view",              Icon: Truck },
  { key: "delivery",    label: "Entregas",             href: "/entregas",          permission: "warehouse:register_movement", Icon: Warehouse },
  { key: "warehouse",   label: "Bodega",               href: "/bodega",            permission: "warehouse:view_stock",        Icon: Package },
  { key: "reports",     label: "Reportes",             href: "/reportes",          permission: "reports:view",                Icon: ChartBar },
]

const pillBase =
  "group inline-flex h-9 items-center gap-2 rounded-[var(--radius-full)] px-3.5 text-[13px] font-medium transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"

/**
 * Toolbar de accesos rápidos, adaptada al rol. La acción principal va como pill
 * llena verde; el resto como pills ghost. Sin tarjetas: una sola fila que envuelve.
 */
export function QuickActions({ session }: { session: Session }) {
  const actions = ACTIONS.filter((action) => can(session, action.permission))
  if (actions.length === 0) return null

  const [primary, ...rest] = actions

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        key={primary.key}
        href={primary.href}
        data-pressable
        className={cn(pillBase, "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-strong)]")}
      >
        <primary.Icon size={15} />
        {primary.label}
      </Link>

      {rest.map((action) => (
        <Link
          key={action.key}
          href={action.href}
          data-pressable
          className={cn(
            pillBase,
            "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-primary-line)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-primary-ink)]",
          )}
        >
          <action.Icon
            size={15}
            className="text-[var(--color-text-muted)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]"
          />
          {action.label}
        </Link>
      ))}
    </div>
  )
}
