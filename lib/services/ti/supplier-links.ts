import { eq, and, asc, isNull, sql, notInArray, type SQL } from "drizzle-orm"
import { IT_RETIRED_STATUSES } from "./constants"
import { db } from "@/db"
import {
  itSupplierLinks, suppliers, itAssets, itMaintenances, itLicenses, workers, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { todayInChile } from "@/lib/utils"
import { assertTiGlobalAccess, type TiWorksiteScope } from "./scope"
import { licenseScopeCondition } from "./licenses"

export interface CreateSupplierLinkInput {
  supplierId: string
  category: string
  notes?: string | null
}

export async function createSupplierLink(
  input: CreateSupplierLinkInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope,
): Promise<string> {
  // El catálogo de proveedores TI es global: un vínculo sirve a activos de
  // cualquier faena. Un rol acotado no puede escribir en él, igual que no puede
  // crear licencias ni sistemas de acceso.
  assertTiGlobalAccess(worksiteIds)
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
  worksiteIds: TiWorksiteScope,
): Promise<void> {
  assertTiGlobalAccess(worksiteIds)
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

export async function listSupplierLinks(filters?: {
  category?: string
  /** Predicado de faena sobre `itAssets`. Acota los agregados, no el catálogo. */
  assetScope?: SQL
  /** Faenas del usuario; acota el conteo de licencias por sus asignaciones. */
  worksiteIds?: TiWorksiteScope
}) {
  const conditions: SQL[] = []
  if (filters?.category) conditions.push(eq(itSupplierLinks.category, filters.category))

  // El catálogo es global (un proveedor sirve a todas las faenas), pero sus
  // cifras no pueden serlo: sin esto, un rol de una faena veía el gasto de
  // mantención de toda la empresa y lo usaba para negociar.
  //
  // Los cuatro agregados se resuelven con subconsultas agrupadas y LEFT JOIN,
  // no con cuatro correlacionadas por proveedor: el plan anterior ejecutaba
  // 4 × N subconsultas en un solo statement.
  const assetScopeCondition = filters?.assetScope
  const licenseScope = filters?.worksiteIds
    ? licenseScopeCondition(filters.worksiteIds)
    : undefined

  const assetAgg = db
    .select({
      supplierId: itAssets.supplierId,
      total: sql<number>`count(*)::int`.as("asset_count"),
    })
    .from(itAssets)
    .where(and(
      isNull(itAssets.deletedAt),
      assetScopeCondition,
    ))
    .groupBy(itAssets.supplierId)
    .as("asset_agg")

  // La mantención de un activo eliminado del inventario no es accionable para
  // negociar con el proveedor; se excluye del agregado (antes la subconsulta
  // correlacionada la contaba). Es un cambio deliberado de universo.
  const maintenanceAgg = db
    .select({
      supplierId: itMaintenances.supplierId,
      total: sql<number>`count(*)::int`.as("maintenance_count"),
      cost: sql<number>`coalesce(sum(${itMaintenances.cost}), 0)::float8`.as("maintenance_cost"),
    })
    .from(itMaintenances)
    .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
    .where(and(
      isNull(itMaintenances.voidedAt),
      isNull(itAssets.deletedAt),
      assetScopeCondition,
    ))
    .groupBy(itMaintenances.supplierId)
    .as("maintenance_agg")

  const licenseAgg = db
    .select({
      supplierId: itLicenses.supplierId,
      total: sql<number>`count(*)::int`.as("license_count"),
    })
    .from(itLicenses)
    .where(licenseScope)
    .groupBy(itLicenses.supplierId)
    .as("license_agg")

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
      assetCount: sql<number>`coalesce(${assetAgg.total}, 0)`,
      maintenanceCount: sql<number>`coalesce(${maintenanceAgg.total}, 0)`,
      maintenanceCost: sql<number>`coalesce(${maintenanceAgg.cost}, 0)`,
      licenseCount: sql<number>`coalesce(${licenseAgg.total}, 0)`,
    })
    .from(itSupplierLinks)
    .innerJoin(suppliers, eq(itSupplierLinks.supplierId, suppliers.id))
    .leftJoin(assetAgg, eq(assetAgg.supplierId, itSupplierLinks.supplierId))
    .leftJoin(maintenanceAgg, eq(maintenanceAgg.supplierId, itSupplierLinks.supplierId))
    .leftJoin(licenseAgg, eq(licenseAgg.supplierId, itSupplierLinks.supplierId))
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
  // Mismo parque vigente que cuenta el tile "Garantías por vencer" del
  // tablero, que es quien enlaza acá: sin esta exclusión el tile mostraba 0 y
  // el listado una fila, porque la garantía de un activo dado de baja no es
  // accionable pero seguía apareciendo en la lista.
  const conditions: SQL[] = [
    isNull(itAssets.deletedAt),
    notInArray(itAssets.status, [...IT_RETIRED_STATUSES]),
    sql`${itAssets.warrantyEndDate} IS NOT NULL`,
  ]
  if (filters.supplierId) conditions.push(eq(itAssets.supplierId, filters.supplierId))
  if (filters.scope) conditions.push(filters.scope)

  const today = sql`${todayInChile()}`
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
      worksiteId: itAssets.worksiteId,
      worksiteName: worksites.name,
    })
    .from(itAssets)
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .leftJoin(suppliers, eq(itAssets.supplierId, suppliers.id))
    .leftJoin(workers, eq(itAssets.workerId, workers.id))
    .where(and(...conditions))
    .orderBy(asc(itAssets.warrantyEndDate))
}
