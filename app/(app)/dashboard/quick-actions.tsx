import type { ComponentType } from "react"
import type { Session } from "next-auth"
import Link from "next/link"
import { can } from "@/lib/auth/can"
import type { Permission } from "@/modules/permissions"
import { Button } from "@/components/ui/button"
import {
  ChartBar,
  ChartLine,
  CheckSquare,
  ClipboardText,
  Package,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Warehouse,
} from "@phosphor-icons/react/dist/ssr"
import { DashboardActionMenu } from "./dashboard-action-menu"

type IconComponent = ComponentType<{ size: number; className?: string }>

interface ActionDef {
  key:        string
  label:      string
  href:       string
  permission: Permission
  Icon:       IconComponent
}

/*
 * El orden es también la jerarquía: la primera acción disponible se vuelve
 * primaria. El resto se conserva en el menú contextual, sin perder accesos.
 *
 * "Revisar aprobaciones" va primero y "Nueva solicitud" segundo. Con el orden
 * anterior, la acción primaria de Jefatura era "Nueva solicitud" —crear una
 * solicitud no es trabajo de jefatura, decidir sobre ellas sí— y quien no puede
 * aprobar no tiene el permiso, así que para un solicitante la primaria sigue
 * siendo la suya.
 *
 * Se agregan los dos accesos que faltaban: analítica y prevención. El módulo con
 * más permisos de la plataforma (111) no tenía ni un acceso rápido, y
 * `/analitica` —la pantalla con el detalle filtrable— no estaba enlazada desde
 * ningún punto del dashboard.
 */
const ACTIONS: ActionDef[] = [
  { key: "approvals",   label: "Revisar aprobaciones", href: "/aprobaciones",      permission: "approvals:approve",           Icon: CheckSquare },
  { key: "new-request", label: "Nueva solicitud",      href: "/solicitudes/nueva", permission: "requests:create",             Icon: ClipboardText },
  { key: "new-oc",      label: "Emitir OC",            href: "/compras/nueva",     permission: "purchasing:create_order",     Icon: ShoppingCart },
  { key: "analytics",   label: "Analítica",            href: "/analitica",         permission: "analytics:view",              Icon: ChartLine },
  { key: "prevention",  label: "Prevención",           href: "/prevencion",        permission: "prevention:pdtp:view",        Icon: ShieldCheck },
  { key: "receiving",   label: "Recepción",            href: "/recepcion",         permission: "receiving:view",              Icon: Truck },
  { key: "delivery",    label: "Entregas",             href: "/entregas",          permission: "warehouse:register_movement", Icon: Warehouse },
  { key: "warehouse",   label: "Bodega",               href: "/bodega",            permission: "warehouse:view_stock",        Icon: Package },
  { key: "reports",     label: "Reportes",             href: "/reportes",          permission: "reports:view",                Icon: ChartBar },
]

/**
 * El filtrado de permisos se ejecuta en el servidor. Sólo el popover de
 * acciones secundarias cruza a cliente, con una lista ya autorizada.
 */
export function QuickActions({ session }: { session: Session }) {
  const actions = ACTIONS.filter((action) => can(session, action.permission))
  const [primary, secondary, ...overflow] = actions
  if (!primary) return null

  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm">
        <Link href={primary.href}>
          <primary.Icon size={15} />
          {primary.label}
        </Link>
      </Button>
      {secondary && (
        <Button asChild size="sm" variant="secondary" className="hidden sm:inline-flex">
          <Link href={secondary.href}>
            <secondary.Icon size={15} />
            {secondary.label}
          </Link>
        </Button>
      )}
      {(overflow.length > 0 || secondary) && (
        <DashboardActionMenu
          secondary={secondary ? { key: secondary.key, label: secondary.label, href: secondary.href } : undefined}
          actions={overflow.map(({ key, label, href }) => ({ key, label, href }))}
        />
      )}
    </div>
  )
}
