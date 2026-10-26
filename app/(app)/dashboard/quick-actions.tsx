import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"
import type { OperationalQueueResult } from "@/lib/services/operational-work-queue"
import { DashboardActionMenu } from "./dashboard-action-menu"
import { resolveQuickActions } from "./dashboard-quick-actions"
import type { DashboardScope } from "./dashboard-scope"

/**
 * La cabecera de Inicio sólo ofrece "Más acciones": las altas reales (Nueva
 * solicitud, Nueva OC). El botón "Ver N vencidas" se retiró: ese número ya es la
 * alerta de "Requiere atención" del bloque "Hoy" y repetirlo en la cabecera lo
 * ponía dos veces en la primera pantalla (A5). Analítica, Prevención, Recepción,
 * Entregas, Bodega y Reportes ya son entradas del sidebar.
 *
 * El filtrado de permisos se ejecuta en el servidor. Sólo el popover de
 * acciones cruza a cliente, con una lista ya autorizada.
 *
 * `scope` y `summary` ya no se usan —eran la materia prima de la acción
 * primaria calculada— pero se aceptan para no romper a quien monta el
 * componente (`page.tsx`); pueden dejar de pasarse.
 */
export function QuickActions({ session }: {
  session: Session
  /** @deprecated Sin uso desde que la primaria calculada se retiró. */
  scope?: DashboardScope
  /** @deprecated Sin uso desde que la primaria calculada se retiró. */
  summary?: OperationalQueueResult["summary"]
}) {
  const actions = resolveQuickActions({ can: (permission) => can(session, permission) })
  if (actions.length === 0) return null

  return <DashboardActionMenu actions={actions} />
}
