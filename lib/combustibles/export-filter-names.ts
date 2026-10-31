import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProducts, fuelSuppliers, fuelTaeLoadingPoints, fuelVehicles, worksites } from "@/db/schema"

export interface ExportFilterIds {
  worksiteId?: string
  loadingPointId?: string
  fuelSupplierId?: string
  vehicleId?: string
  productId?: string
}

export type ExportFilterNames = Partial<Record<keyof ExportFilterIds, string>>

/**
 * Nombres de los filtros por identificador que llevan las exportaciones de
 * Combustible, para que la hoja «Metadatos» los diga en palabras. Un nombre que
 * no se pueda resolver se deja fuera y la hoja muestra el identificador: un
 * metadato nunca debe tumbar la exportación.
 */
export async function resolveExportFilterNames(ids: ExportFilterIds): Promise<ExportFilterNames> {
  async function nameOf(lookup: () => Promise<Array<{ name: string | null }>>): Promise<string | undefined> {
    try { return (await lookup())[0]?.name ?? undefined } catch { return undefined }
  }
  const [worksiteId, loadingPointId, fuelSupplierId, vehicleId, productId] = await Promise.all([
    ids.worksiteId ? nameOf(() => db.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, ids.worksiteId!)).limit(1)) : undefined,
    ids.loadingPointId ? nameOf(() => db.select({ name: fuelTaeLoadingPoints.name }).from(fuelTaeLoadingPoints).where(eq(fuelTaeLoadingPoints.id, ids.loadingPointId!)).limit(1)) : undefined,
    ids.fuelSupplierId ? nameOf(() => db.select({ name: fuelSuppliers.name }).from(fuelSuppliers).where(eq(fuelSuppliers.id, ids.fuelSupplierId!)).limit(1)) : undefined,
    ids.vehicleId ? nameOf(() => db.select({ name: fuelVehicles.plate }).from(fuelVehicles).where(eq(fuelVehicles.id, ids.vehicleId!)).limit(1)) : undefined,
    ids.productId ? nameOf(() => db.select({ name: fuelProducts.name }).from(fuelProducts).where(eq(fuelProducts.id, ids.productId!)).limit(1)) : undefined,
  ])
  return { worksiteId, loadingPointId, fuelSupplierId, vehicleId, productId }
}
