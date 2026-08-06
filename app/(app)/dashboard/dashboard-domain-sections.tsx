import type { DashboardDomainKey } from "./dashboard-domains"
import type { DomainSectionsProps } from "./sections/shared"
import { AcquisitionsSection } from "./sections/acquisitions-section"
import { FieldControlSection } from "./sections/field-control-section"
import { FinanceSection } from "./sections/finance-section"
import { FleetSection } from "./sections/fleet-section"
import { GovernanceSection } from "./sections/governance-section"
import { PreventionSection } from "./sections/prevention-section"
import { WarehouseSection } from "./sections/warehouse-section"

/**
 * Orquestador de las secciones por dominio.
 *
 * Era un archivo de 638 líneas con las siete secciones dentro. Cada una tiene su
 * propio lote de consultas y su propia fila de KPIs: no comparten nada salvo el
 * contrato de props, que vive en `sections/shared.ts`. Partirlo por dominio es
 * la misma frontera que ya usa el selector de vistas — una vista, un archivo.
 */

export type { DomainSectionsProps }

export const SECTION_BY_DOMAIN: Record<DashboardDomainKey, (props: DomainSectionsProps) => Promise<React.JSX.Element>> = {
  finanzas: FinanceSection,
  adquisiciones: AcquisitionsSection,
  bodega: WarehouseSection,
  prevencion: PreventionSection,
  flota: FleetSection,
  terreno: FieldControlSection,
  gobernanza: GovernanceSection,
}

/**
 * La sección del dominio activo. Una, no seis.
 *
 * `DashboardDomainSections` montaba las seis con un `Suspense` cada una: la de
 * Adquisiciones sola dispara ~20 consultas, y se pagaban todas en cada carga
 * aunque el usuario mirara Prevención.
 */
export function DashboardDomainSection({ domain, ...props }: DomainSectionsProps & { domain: DashboardDomainKey }) {
  const Section = SECTION_BY_DOMAIN[domain]
  return <Section {...props} />
}
