import { and, asc, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpCatalogActivities, pdtpPrograms } from "@/db/schema"
import type { Client } from "@/lib/services/prevention-inspections-access"

/*
 * Identidad corporativa de las actividades del programa anual, indexada por el
 * número con que las conoce el programa vigente.
 *
 * Vive en su propio archivo y no en `catalogs.ts` porque `templates.ts` la
 * necesita al incorporar una plantilla y `catalogs.ts` ya importa de
 * `templates.ts`: declararla en el segundo cerraría un ciclo de importación.
 */

export type PdtpActivityIdentity = {
  /** Número de la actividad (`pdtp_activities.n`) en el programa vigente. */
  n: number
  /** Identidad estable del catálogo corporativo: lo que enlazan los bindings. */
  catalogActivityId: string
  /** Nombre de la actividad tal como la ve el programa. */
  name: string
  year: number
  /** Estado de la identidad en el catálogo. Una retirada no puede enlazarse de nuevo. */
  catalogStatus: string
}

export type PdtpActivityIdentityMap = {
  byNumber: Map<number, PdtpActivityIdentity>
  byCatalogId: Map<string, PdtpActivityIdentity>
}

/**
 * Actividades activas de los programas activos que ya tienen identidad de
 * catálogo. Una actividad sin identidad (`catalog_activity_id` nulo) no entra:
 * no hay a qué enlazarla, y la consecuencia —seguir acreditando por número—
 * es la que el llamador debe decidir.
 *
 * PREV-C03.6: en diciembre-enero conviven dos programas activos. Como la
 * plantilla declara números y no años, cuando un número se repite gana el del
 * año más reciente (misma regla que `listInspectionPdtpActivityOptions`). Lo
 * mismo vale para una identidad que aparece en dos programas.
 */
export async function loadPdtpActivityIdentityMap(client: Client = db): Promise<PdtpActivityIdentityMap> {
  const rows = await client.select({
    n: pdtpActivities.n,
    catalogActivityId: pdtpActivities.catalogActivityId,
    name: pdtpActivities.activity,
    year: pdtpPrograms.year,
    catalogStatus: pdtpCatalogActivities.status,
  }).from(pdtpActivities)
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
    .innerJoin(pdtpCatalogActivities, eq(pdtpCatalogActivities.id, pdtpActivities.catalogActivityId))
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpActivities.status, "active")))
    .orderBy(desc(pdtpPrograms.year), asc(pdtpActivities.n))

  const byNumber = new Map<number, PdtpActivityIdentity>()
  const byCatalogId = new Map<string, PdtpActivityIdentity>()
  for (const row of rows) {
    if (!row.catalogActivityId) continue
    const identity: PdtpActivityIdentity = {
      n: row.n,
      catalogActivityId: row.catalogActivityId,
      name: row.name,
      year: row.year,
      catalogStatus: row.catalogStatus,
    }
    if (!byNumber.has(identity.n)) byNumber.set(identity.n, identity)
    if (!byCatalogId.has(identity.catalogActivityId)) byCatalogId.set(identity.catalogActivityId, identity)
  }
  return { byNumber, byCatalogId }
}

/**
 * Traduce números de actividad a identidades de catálogo.
 *
 * `unmappedNumbers` lista los que no se pueden enlazar: no existen en el
 * programa vigente, no tienen identidad o su identidad está retirada. Quien
 * cablea debe tratar un eje con huecos como "no enlazable": un binding parcial
 * gana sobre los números (`resolvePdtpAccreditationTarget`) y apagaría en
 * silencio los que faltan.
 */
export function resolvePdtpNumbersToCatalogIds(
  numbers: readonly number[],
  identities: PdtpActivityIdentityMap,
): { catalogActivityIds: string[]; unmappedNumbers: number[] } {
  const catalogActivityIds: string[] = []
  const unmappedNumbers: number[] = []
  for (const n of numbers) {
    const identity = identities.byNumber.get(n)
    if (!identity || identity.catalogStatus === "retired") {
      unmappedNumbers.push(n)
      continue
    }
    if (!catalogActivityIds.includes(identity.catalogActivityId)) catalogActivityIds.push(identity.catalogActivityId)
  }
  return { catalogActivityIds, unmappedNumbers }
}
