import { and, asc, inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { equipmentScope, type MantViewer } from "./access"

/**
 * Faenas del filtro del Historial de mantenciones: todas las del alcance de quien mira, ACTIVAS O NO. A diferencia
 * del Panel (`loadPanelWorksites`, sólo activas), el historial de una faena cerrada (Pacífico, Fábrica de Puertas)
 * sigue siendo evidencia y se tiene que poder filtrar.
 */
export async function loadHistoryWorksites(viewer: MantViewer): Promise<Array<{ id: string; name: string; isActive: boolean }>> {
  const scope = equipmentScope(viewer)
  if (scope !== "all" && scope.length === 0) return []
  return db
    .select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
    .from(worksites)
    .where(and(scope === "all" ? undefined : inArray(worksites.id, scope)))
    .orderBy(asc(worksites.name))
}
