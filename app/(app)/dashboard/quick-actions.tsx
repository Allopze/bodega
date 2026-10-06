import type { Session } from "next-auth"
import Link from "next/link"
import { can } from "@/lib/auth/can"
import type { OperationalQueueResult } from "@/lib/services/operational-work-queue"
import { Button } from "@/components/ui/button"
import { DashboardActionMenu } from "./dashboard-action-menu"
import { resolveQuickActions } from "./dashboard-quick-actions"
import type { DashboardScope } from "./dashboard-scope"

/**
 * La primaria es **calculada** (`resolveQuickActions`): el mayor grupo de
 * pendientes que el usuario puede atender ("Ver 215 vencidas"). "Más acciones"
 * sólo ofrece altas reales (Nueva solicitud, Nueva OC); Analítica, Prevención,
 * Recepción, Entregas, Bodega y Reportes ya son entradas del sidebar y repetirlas
 * acá sólo engordaba el menú.
 *
 * El filtrado de permisos se ejecuta en el servidor. Sólo el popover de
 * acciones secundarias cruza a cliente, con una lista ya autorizada.
 */
export function QuickActions({ session, scope, summary }: {
  session: Session
  scope: DashboardScope
  summary: OperationalQueueResult["summary"]
}) {
  const { primary, more } = resolveQuickActions({
    can: (permission) => can(session, permission),
    scope,
    summary,
  })
  if (!primary) return null

  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm">
        <Link href={primary.href}>{primary.label}</Link>
      </Button>
      {more.length > 0 && <DashboardActionMenu actions={more} />}
    </div>
  )
}
