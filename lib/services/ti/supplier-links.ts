import { eq, and, asc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itSupplierLinks, suppliers, itAssets, itMaintenances, itLicenses, workers,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

export interface CreateSupplierLinkInput {
  supplierId: string
  category: string
  notes?: string | null
}

export async function createSupplierLink(
  input: CreateSupplierLinkInput,
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId))
    if (!supplier) throw new Error("Proveedor no encontrado")

    await tx.insert(itSupplierLinks).values({
      id,
      supplierId: input.supplierId,
      category: input.category,
      notes: input.notes?.trim() || null,
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_supplier_link",
      entityId: id,
      newState: { supplierId: input.supplierId, category: input.category },
    }, tx)
  })
  return id
}

export async function deleteSupplierLink(
  linkId: string,
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [link] = await tx.select().from(itSupplierLinks).where(eq(itSupplierLinks.id, linkId))
    if (!link) throw new Error("Vínculo no encontrado")
    await tx.delete(itSupplierLinks).where(eq(itSupplierLinks.id, linkId))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "it_supplier_link",
      entityId: linkId,
      oldState: { supplierId: link.supplierId, category: link.category },
    }, tx)
  })
}

export async function listSupplierLinks(filters?: { category?: string }) {
  const conditions: SQL[] = []
  if (filters?.category) conditions.push(eq(itSupplierLinks.category, filters.category))
  return db
    .select({
      id: itSupplierLinks.id,
      supplierId: itSupplierLinks.supplierId,
      category: itSupplierLinks.category,
      notes: itSupplierLinks.notes,
      createdAt: itSupplierLinks.createdAt,
      supplierName: suppliers.name,
      supplierRut: suppliers.rut,
      supplierEmail: suppliers.email,
      supplierPhone: suppliers.phone,
      assetCount: sql<number>`(SELECT count(*)::int FROM ${itAssets} WHERE ${itAssets.supplierId} = ${itSupplierLinks.supplierId} AND ${itAssets.deletedAt} IS NULL)`,
      maintenanceCount: sql<number>`(SELECT count(*)::int FROM ${itMaintenances} WHERE ${itMaintenances.supplierId} = ${itSupplierLinks.supplierId})`,
      maintenanceCost: sql<number>`(SELECT coalesce(sum(${itMaintenances.cost}), 0)::float8 FROM ${itMaintenances} WHERE ${itMaintenances.supplierId} = ${itSupplierLinks.supplierId})`,
      licenseCount: sql<number>`(SELECT count(*)::int FROM ${itLicenses} WHERE ${itLicenses.supplierId} = ${itSupplierLinks.supplierId})`,
    })
    .from(itSupplierLinks)
    .innerJoin(suppliers, eq(itSupplierLinks.supplierId, suppliers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(suppliers.name))
}

export async function listSuppliersWithLinks() {
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      rut: suppliers.rut,
      email: suppliers.email,
      phone: suppliers.phone,
      categories: sql<string[]>`array_agg(${itSupplierLinks.category})`,
    })
    .from(suppliers)
    .innerJoin(itSupplierLinks, eq(suppliers.id, itSupplierLinks.supplierId))
    .groupBy(suppliers.id)
    .orderBy(asc(suppliers.name))
}

/* ── Garantías ────────────────────────────────────────────────────────────── */

export type WarrantyWindow = "active" | "expiring_30" | "expiring_60" | "expiring_90" | "expired"

export async function listAssetsByWarranty(filters: {
  window?: WarrantyWindow
  supplierId?: string
  scope?: SQL
}) {
  const conditions: SQL[] = [sql`${itAssets.warrantyEndDate} IS NOT NULL`]
  if (filters.supplierId) conditions.push(eq(itAssets.supplierId, filters.supplierId))
  if (filters.scope) conditions.push(filters.scope)

  const today = sql`current_date::text`
  if (filters.window === "active") conditions.push(sql`${itAssets.warrantyEndDate} >= ${today}`)
  if (filters.window === "expiring_30") conditions.push(sql`${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 30)::text`)
  if (filters.window === "expiring_60") conditions.push(sql`${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 60)::text`)
  if (filters.window === "expiring_90") conditions.push(sql`${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 90)::text`)
  if (filters.window === "expired") conditions.push(sql`${itAssets.warrantyEndDate} < ${today}`)

  return db
    .select({
      id: itAssets.id,
      code: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      status: itAssets.status,
      warrantyEndDate: itAssets.warrantyEndDate,
      purchaseDate: itAssets.purchaseDate,
      supplierName: suppliers.name,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
    })
    .from(itAssets)
    .leftJoin(suppliers, eq(itAssets.supplierId, suppliers.id))
    .leftJoin(workers, eq(itAssets.workerId, workers.id))
    .where(and(...conditions))
    .orderBy(asc(itAssets.warrantyEndDate))
}
