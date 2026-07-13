import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { count, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProducts, fuelVehicleProducts } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { FuelProductCatalog } from "./product-catalog"

export const metadata: Metadata = { title: "Productos de combustible" }

export default async function FuelProductsPage() {
  try { await requirePermission("admin:fleet_catalog") } catch { redirect("/forbidden") }
  const rows = await db.select({ id: fuelProducts.id, code: fuelProducts.code, name: fuelProducts.name, category: fuelProducts.category, unit: fuelProducts.unit, aliases: fuelProducts.aliases, description: fuelProducts.description, isSystem: fuelProducts.isSystem, isActive: fuelProducts.isActive, vehicleCount: count(fuelVehicleProducts.vehicleId) }).from(fuelProducts).leftJoin(fuelVehicleProducts, eq(fuelVehicleProducts.productId, fuelProducts.id)).groupBy(fuelProducts.id).orderBy(fuelProducts.name)
  return <PageContainer><FuelProductCatalog rows={rows.map((row) => ({ ...row, vehicleCount: Number(row.vehicleCount) }))} /></PageContainer>
}
