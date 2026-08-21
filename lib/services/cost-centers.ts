import { eq } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { costCenters } from "@/db/schema"
import { and, inArray, isNull, or, type SQL } from "drizzle-orm"

/**
 * Un centro de costo pertenece a una faena (o es transversal si `worksiteId`
 * es NULL). Elegirlo desde otra faena imputa el gasto a una estructura ajena,
 * así que el destino se valida contra la faena del hecho —no contra el alcance
 * de quien lo registra, que puede ser global— en cada superficie que lo acepte.
 */
export async function assertCostCenterAllowed(
  client: DB | Tx,
  costCenterId: string,
  worksiteId: string | null,
) {
  const [center] = await client
    .select({ id: costCenters.id, worksiteId: costCenters.worksiteId, isActive: costCenters.isActive })
    .from(costCenters)
    .where(eq(costCenters.id, costCenterId))
    .limit(1)
  if (!center || !center.isActive) throw new Error("Centro de costo no disponible")
  // `worksiteId` nulo = el hecho no tiene faena (una propuesta transversal, por
  // ejemplo): entonces sólo se exige que el centro exista y esté vigente.
  if (center.worksiteId && worksiteId && center.worksiteId !== worksiteId) {
    throw new Error("El centro de costo pertenece a otra faena")
  }
}

/**
 * Predicado de catálogo: vigentes, más los transversales, más los de las faenas
 * visibles. `worksiteIds === null` significa alcance global.
 */
export function costCenterOptionsWhere(worksiteIds: string[] | null): SQL | undefined {
  return and(
    eq(costCenters.isActive, true),
    worksiteIds === null
      ? undefined
      : worksiteIds.length > 0
        ? or(isNull(costCenters.worksiteId), inArray(costCenters.worksiteId, worksiteIds))
        : isNull(costCenters.worksiteId),
  )
}
