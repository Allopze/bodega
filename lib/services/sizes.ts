/**
 * Size catalog helper service (I-3).
 * Provides canonical size choices from size_catalog table.
 */
import { db } from "@/db"
import { sizeCatalog } from "@/db/schema/sizes"
import { eq, and, asc } from "drizzle-orm"

export async function getCanonicalSizesByFamily(family: string): Promise<string[]> {
  const rows = await db
    .select({ code: sizeCatalog.code })
    .from(sizeCatalog)
    .where(and(eq(sizeCatalog.family, family), eq(sizeCatalog.isActive, true)))
    .orderBy(asc(sizeCatalog.displayOrder))

  return rows.map((r) => r.code)
}
