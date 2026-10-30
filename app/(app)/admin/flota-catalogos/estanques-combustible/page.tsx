import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProducts, fuelStorageLocations, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { StorageCatalog } from "./storage-catalog"
export default async function FuelStorageLocationsPage() { try { await requirePermission("admin:fleet_catalog") } catch { redirect("/forbidden") }; const [rows, sites, products] = await Promise.all([db.query.fuelStorageLocations.findMany({ with: { worksite: { columns: { name: true } }, product: { columns: { name: true } } }, orderBy: [fuelStorageLocations.name] }), db.query.worksites.findMany({ orderBy: [worksites.name] }), db.query.fuelProducts.findMany({ where: eq(fuelProducts.isActive, true), orderBy: [fuelProducts.name] })]); return <PageContainer><StorageCatalog rows={rows} worksites={sites} products={products} /></PageContainer> }
