/**
 * modules/registry.ts — El único punto de unión del sistema modular
 *
 * Agregar un módulo nuevo = agregar UNA línea de import + una línea en el array.
 * Nada más. El type `Permission`, el seed y la navegación se derivan automáticamente.
 *
 * Orden de registro: módulos base primero (admin), luego operacionales, luego
 * de soporte (reports). Los módulos de prevención de riesgos se agregan al final.
 */

import type { ModuleManifest } from "@/modules/manifest-types"

import { adminModule }        from "@/modules/admin/manifest"
import { requestsModule }     from "@/modules/requests/manifest"
import { approvalsModule }    from "@/modules/approvals/manifest"
import { purchasingModule }   from "@/modules/purchasing/manifest"
import { receivingModule }    from "@/modules/receiving/manifest"
import { warehouseModule }    from "@/modules/warehouse/manifest"
import { deliveriesModule }   from "@/modules/deliveries/manifest"
import { traceabilityModule } from "@/modules/traceability/manifest"
import { reportsModule }      from "@/modules/reports/manifest"

/**
 * Registry central — array `as const` de todos los módulos registrados.
 * TypeScript infiere los literal types de cada `permissions` array,
 * permitiendo que `modules/permissions.ts` derive el type `Permission` sin
 * mantener una lista manual.
 */
export const registry = [
  adminModule,
  requestsModule,
  approvalsModule,
  purchasingModule,
  receivingModule,
  warehouseModule,
  deliveriesModule,
  traceabilityModule,
  reportsModule,
  // ── Prevención de riesgos (próximas entregas) ──────────────────────────
  // incidentesModule,
  // inspeccionesModule,
  // iperModule,
  // capacitacionesModule,
] as const satisfies readonly ModuleManifest[]

export type Registry = typeof registry
