import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { SectionNav, type SectionNavItem } from "@/components/ui/section-nav"

/**
 * Pestañas de «Mantenciones» en el menú de Flota. Una sola fuente para que las
 * tres pantallas (órdenes, planes y política documental) pinten la misma barra
 * con el mismo criterio de permisos; cada página dice cuál es la activa.
 *
 * Es un módulo de servidor (lee la sesión): las pantallas cliente de planes y
 * política reciben la barra ya armada como `nav` en vez de importarlo.
 */
export type MaintenanceTab = "ot" | "planes" | "politica"

/**
 * Las políticas documentales son globales (`saveMaintenanceDocumentPolicy`
 * rechaza a un rol acotado), así que solo quien puede editarlas tiene motivo
 * para llegar a ellas. La página de política usa este mismo predicado para su
 * modo de edición: pestaña y pantalla no pueden discrepar.
 */
export function canManageMaintenanceDocumentPolicies(session: Session): boolean {
  return can(session, "mantenciones:edit") && isGlobalRole(session)
}

/** Todas exigen `mantenciones:view`, que es el gate de la sección. */
export function maintenanceNavItems(session: Session): SectionNavItem[] {
  const items: SectionNavItem[] = [
    { key: "ot", href: "/mantenciones", label: "Órdenes de trabajo" },
    { key: "planes", href: "/mantenciones/planes", label: "Planes preventivos" },
  ]
  if (canManageMaintenanceDocumentPolicies(session)) {
    items.push({ key: "politica", href: "/mantenciones/politicas-documentales", label: "Políticas documentales" })
  }
  return items
}

/** La barra de pestañas de la sección, lista para ir justo después del `PageHeader`. */
export function MaintenanceSectionNav({ session, activeKey }: { session: Session; activeKey: MaintenanceTab }) {
  return <SectionNav items={maintenanceNavItems(session)} activeKey={activeKey} ariaLabel="Secciones de mantenciones" />
}
