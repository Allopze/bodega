import type { InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { assertRouteModuleEnabled } from "@/lib/services/module-toggles"

/**
 * Toggle del submódulo. Inspecciones, observaciones y auditorías del SGSST
 * viven en una sola ruta desde que se fusionaron (2026-08-21), así que basta
 * la ruta del motor.
 *
 * Antes esto resolvía el `kind` persistido con siete joins —plantilla,
 * programa, run, hallazgo, respuesta, documento, evidencia— porque
 * `/prevencion/auditorias` tenía su propio toggle y había que impedir operar
 * una auditoría desde la ruta hermana cuando el suyo estaba apagado. Con un
 * único owner esa distinción no existe: el toggle que valía era el de la ruta.
 */
export type { InspectionAccess }

export async function assertInspectionOperationEnabled(): Promise<void> {
  await assertRouteModuleEnabled("/prevencion/inspecciones")
}
