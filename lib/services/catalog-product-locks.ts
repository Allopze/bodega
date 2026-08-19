import { asc, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { products } from "@/db/schema"

/**
 * Locks existing catalog products in the one PostgreSQL-defined order used by
 * direct-request preflight reads. Bulk catalog writers call this before they
 * update product fields or replace attributes, avoiding a product-lock cycle
 * with an EPP confirmation that spans several catalog items.
 */
export async function lockCatalogProductsForUpdateTx(
  tx: Tx,
  productIds: Iterable<string>,
): Promise<Set<string>> {
  const ids = [...new Set([...productIds].filter(Boolean))]
  if (ids.length === 0) return new Set()

  const rows = await tx
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, ids))
    .orderBy(asc(products.id))
    .for("update")

  return new Set(rows.map((product) => product.id))
}
