import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"
import { DashboardActionMenu } from "./dashboard-action-menu"
import { resolveQuickActions } from "./dashboard-quick-actions"

/**
 * La cabecera de Inicio sólo ofrece "Más acciones": las altas reales (Nueva
 * solicitud, Nueva OC). El botón "Ver N vencidas" se retiró: ese número ya es la
 * alerta de "Requiere atención" del bloque "Hoy" y repetirlo en la cabecera lo
 * ponía dos veces en la primera pantalla (A5). Analítica, Prevención, Recepción,
 * Entregas, Bodega y Reportes ya son entradas del sidebar.
 *
 * El filtrado de permisos se ejecuta en el servidor. Sólo el popover de
 * acciones cruza a cliente, con una lista ya autorizada.
 */
export function QuickActions({ session }: { session: Session }) {
  const actions = resolveQuickActions({ can: (permission) => can(session, permission) })
  if (actions.length === 0) return null

  return <DashboardActionMenu actions={actions} />
}
