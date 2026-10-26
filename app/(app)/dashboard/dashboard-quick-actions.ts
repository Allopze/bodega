import type { Permission } from "@/modules/permissions"

/**
 * Las acciones de la cabecera de Inicio: sólo altas reales.
 *
 * Hubo además una acción **primaria calculada** ("Ver 215 vencidas", "Revisar
 * aprobaciones"…). Se retiró: esa cifra ya es la alerta "Requiere atención" del
 * bloque "Hoy", justo debajo, así que la misma urgencia salía dos veces en la
 * primera pantalla (A5). Quedó sólo "Más acciones", que no repite nada.
 */

export interface QuickAction {
  key: string
  label: string
  href: string
}

type Can = (permission: Permission) => boolean

/**
 * Altas reales: crear algo. La navegación (Analítica, Prevención, Recepción,
 * Entregas, Bodega, Reportes) ya está en el sidebar y se quitó de acá.
 */
const CREATE_ACTIONS: Array<QuickAction & { permission: Permission }> = [
  { key: "new-request", label: "Nueva solicitud", href: "/solicitudes/nueva", permission: "requests:create" },
  { key: "new-oc",      label: "Nueva OC",        href: "/compras/nueva",     permission: "purchasing:create_order" },
]

/** Las altas que la sesión puede hacer, en el orden en que se ofrecen. */
export function resolveQuickActions(input: { can: Can }): QuickAction[] {
  return CREATE_ACTIONS
    .filter((action) => input.can(action.permission))
    .map(({ key, label, href }) => ({ key, label, href }))
}
