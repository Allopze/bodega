import type { ComponentProps } from "react"
import {
  DashboardSection,
  DashboardSectionFallback,
  type DashboardKpiGroup,
} from "@/components/dashboard/dashboard-section"
import type { DashboardDomain } from "./dashboard-domains"

/** Variante de tile del tablero; vive con `DashboardPanel` y se re-exporta para las secciones. */
export { DASHBOARD_KPI } from "@/components/ui/dashboard-panel"

/*
 * `DomainIndex` vivía acá: un rail de anclas `#dominio-*` sobre una página que
 * tenía las seis secciones montadas a la vez. Lo reemplaza
 * `DashboardViewTabs`, que conmuta la vista en vez de hacer scroll hasta ella.
 */

export type DomainKpiGroup = DashboardKpiGroup

/** Sección de una vista de Inicio: la sección compartida, anclada en el dominio. */
export function DomainSection({ domain, ...rest }: { domain: DashboardDomain } & Omit<ComponentProps<typeof DashboardSection>, "id" | "title">) {
  return <DashboardSection id={domain.anchor} title={domain.title} {...rest} />
}

/** Reserva el alto de una sección para que el índice no salte al resolver. */
export const DomainSectionFallback = DashboardSectionFallback
