import { countOf } from "@/lib/utils"
import type { Permission } from "@/modules/permissions"
import type { OperationalQueueResult } from "@/lib/services/operational-work-queue"
import { pendientesHref } from "./dashboard-today"
import type { DashboardScope } from "./dashboard-scope"

/**
 * La acción primaria de Inicio **se calcula**, no es fija.
 *
 * Antes siempre era "Revisar aprobaciones": apuntaba a una bandeja con un ítem
 * mientras la cola tenía 215 vencidas. Ahora la primaria es el grupo accionable
 * más grande que el usuario puede atender; sólo si no hay ninguno cae a la lógica
 * histórica (aprobaciones → nueva solicitud → nueva OC).
 */

export interface QuickAction {
  key: string
  label: string
  href: string
}

type Can = (permission: Permission) => boolean

/** Grupos que compiten por ser la primaria, con el permiso que exige su destino. */
interface Candidate extends QuickAction {
  count: number
}

/**
 * Altas reales: crear algo. La navegación (Analítica, Prevención, Recepción,
 * Entregas, Bodega, Reportes) ya está en el sidebar y se quitó de acá.
 */
const CREATE_ACTIONS: Array<QuickAction & { permission: Permission }> = [
  { key: "new-request", label: "Nueva solicitud", href: "/solicitudes/nueva", permission: "requests:create" },
  { key: "new-oc",      label: "Nueva OC",        href: "/compras/nueva",     permission: "purchasing:create_order" },
]

export function resolveQuickActions(input: {
  can: Can
  scope: DashboardScope
  summary: OperationalQueueResult["summary"]
}): { primary: QuickAction | null; more: QuickAction[] } {
  const { can, scope, summary } = input
  const canWork = can("operations:view_work")
  const created = CREATE_ACTIONS.filter((action) => can(action.permission))
    .map(({ key, label, href }) => ({ key, label, href }))

  const candidates: Candidate[] = [
    canWork && summary.overdue > 0 ? {
      key: "overdue", count: summary.overdue,
      label: `Ver ${countOf(summary.overdue, "vencida", "vencidas")}`,
      href: pendientesHref(scope, { quick: "overdue" }),
    } : null,
    canWork && summary.critical > 0 ? {
      key: "critical", count: summary.critical,
      label: `Ver ${countOf(summary.critical, "crítica", "críticas")}`,
      href: pendientesHref(scope, { quick: "critical" }),
    } : null,
    can("approvals:approve") && (summary.moduleCounts.aprobaciones ?? 0) > 0 ? {
      key: "approvals", count: summary.moduleCounts.aprobaciones ?? 0,
      label: `Revisar ${countOf(summary.moduleCounts.aprobaciones ?? 0, "aprobación", "aprobaciones")}`,
      href: "/aprobaciones",
    } : null,
    can("receiving:view") && (summary.moduleCounts.recepciones ?? 0) > 0 ? {
      key: "receiving", count: summary.moduleCounts.recepciones ?? 0,
      label: `Atender ${countOf(summary.moduleCounts.recepciones ?? 0, "recepción", "recepciones")}`,
      href: "/recepcion",
    } : null,
    can("deliveries:create") && (summary.moduleCounts.entregas ?? 0) > 0 ? {
      key: "delivery", count: summary.moduleCounts.entregas ?? 0,
      label: `Registrar ${countOf(summary.moduleCounts.entregas ?? 0, "entrega", "entregas")}`,
      href: "/entregas",
    } : null,
  ].filter((candidate): candidate is Candidate => candidate !== null)

  // El mayor; en empate manda el orden de la lista (urgencia primero).
  const largest = candidates.reduce<Candidate | null>(
    (best, candidate) => (best === null || candidate.count > best.count ? candidate : best),
    null,
  )
  if (largest) {
    return { primary: { key: largest.key, label: largest.label, href: largest.href }, more: created }
  }

  // Sin trabajo pendiente: la lógica histórica. Aprobar primero, crear después.
  const fallback: QuickAction[] = [
    ...(can("approvals:approve") ? [{ key: "approvals", label: "Revisar aprobaciones", href: "/aprobaciones" }] : []),
    ...created,
  ]
  const [primary, ...more] = fallback
  return { primary: primary ?? null, more }
}
