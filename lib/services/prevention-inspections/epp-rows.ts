import { and, eq, exists, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  eppProductFamilies,
  eppTypes,
  inventoryMovements,
  preventionInspectionAnswers,
  productCategories,
  products,
  worksiteStock,
} from "@/db/schema"
import {
  isEppUseDefinition,
  resolveEppInspectionDefinition,
  type WorksiteEppRow,
} from "@/lib/prevention/epp-inspection-rows"
import type { ChecklistDefinition } from "@/lib/sst/types"

type Executor = typeof db | Tx

/**
 * EPP que alguna vez estuvieron en la bodega de la faena, con o sin stock hoy.
 *
 * "Alguna vez" es: tiene fila en `worksite_stock` (la fila sobrevive cuando la
 * cantidad llega a cero) o algún movimiento de inventario en esa faena. Se
 * agrupa por familia para que las tallas de un mismo EPP sean una sola fila.
 */
export async function listWorksiteEppRows(executor: Executor, worksiteId: string): Promise<WorksiteEppRow[]> {
  const rows = await executor.select({
    productId: products.id,
    productName: products.name,
    familyId: products.familyId,
    familyName: eppProductFamilies.canonicalName,
    eppTypeCode: eppTypes.code,
  })
    .from(products)
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))
    .leftJoin(eppTypes, eq(eppProductFamilies.eppTypeId, eppTypes.id))
    .where(and(
      sql`(${products.isEpp} = true OR ${productCategories.isEpp} = true)`,
      or(
        exists(executor.select({ one: sql`1` }).from(worksiteStock).where(and(
          eq(worksiteStock.worksiteId, worksiteId),
          eq(worksiteStock.productId, products.id),
        ))),
        exists(executor.select({ one: sql`1` }).from(inventoryMovements).where(and(
          eq(inventoryMovements.worksiteId, worksiteId),
          eq(inventoryMovements.productId, products.id),
        ))),
      ),
    ))

  const byKey = new Map<string, WorksiteEppRow>()
  for (const row of rows) {
    const key = row.familyId ? `fam:${row.familyId}` : `prd:${row.productId}`
    if (byKey.has(key)) continue
    byKey.set(key, {
      key,
      label: (row.familyId && row.familyName) ? row.familyName : row.productName,
      eppTypeCode: row.eppTypeCode ?? null,
    })
  }
  return [...byKey.values()].sort((left, right) => left.label.localeCompare(right.label, "es"))
}

/**
 * Definición efectiva de una ejecución: igual a la de la plantilla, salvo en la
 * inspección de uso y estado de EPP, cuyas filas salen de la bodega de la faena
 * (`resolveEppInspectionDefinition`). Todo camino que lea o valide ítems de un
 * run —ficha, acta impresa, guardado, cierre— pasa por acá para ver lo mismo.
 */
export async function resolveRunDefinition(
  executor: Executor,
  definition: ChecklistDefinition,
  run: { id: string; worksiteId: string; status: string },
  answered?: ReadonlyMap<string, string>,
): Promise<ChecklistDefinition> {
  if (!isEppUseDefinition(definition)) return definition
  const [rows, answeredMap] = await Promise.all([
    listWorksiteEppRows(executor, run.worksiteId),
    answered
      ? Promise.resolve(answered)
      : executor.select({ itemId: preventionInspectionAnswers.itemId, itemLabel: preventionInspectionAnswers.itemLabel })
          .from(preventionInspectionAnswers)
          .where(eq(preventionInspectionAnswers.runId, run.id))
          .then((list) => new Map(list.map((row) => [row.itemId, row.itemLabel] as const))),
  ])
  return resolveEppInspectionDefinition(definition, { rows, answered: answeredMap, runStatus: run.status })
}
