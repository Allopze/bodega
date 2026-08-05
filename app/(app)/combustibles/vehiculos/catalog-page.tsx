import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelProducts, fuelSuppliers, fuelVehicles, worksites, users } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { VehicleActions } from "./vehicle-actions"
import { VehicleCatalogTable } from "./vehicle-table"

export async function FuelVehiclesCatalogPage() {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { redirect("/forbidden") }

  const worksiteScope = resolveWorksiteScope(session)
  const [vehicles, worksitesList, usersList, equipmentTypes, suppliers, products, compatibility] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
      orderBy: [fuelVehicles.plate],
    }),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
    db.query.users.findMany({ where: eq(users.isActive, true), orderBy: [users.name] }),
    db.query.fuelEquipmentTypes.findMany({ orderBy: [fuelEquipmentTypes.sortOrder, fuelEquipmentTypes.name] }),
    db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), orderBy: [fuelSuppliers.name] }),
    db.query.fuelProducts.findMany({ orderBy: [fuelProducts.name] }),
    db.query.fuelVehicleProducts.findMany(),
  ])
  const formEquipmentTypes = equipmentTypes.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    defaultMeterType: item.defaultMeterType,
    defaultPerformanceUnit: item.defaultPerformanceUnit,
    isActive: item.isActive,
  }))
  const formSuppliers = suppliers.map((item) => ({ id: item.id, name: item.name }))
  const formProducts = products.map((item) => ({ id: item.id, name: item.name, unit: item.unit, isActive: item.isActive }))
  const productIdsByVehicle = new Map<string, string[]>()
  for (const item of compatibility) productIdsByVehicle.set(item.vehicleId, [...(productIdsByVehicle.get(item.vehicleId) ?? []), item.productId])

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Vehículos de combustible"
        description="Catálogo administrativo de vehículos que cargan combustible."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de flota", href: "/admin/flota-catalogos" },
          { label: "Vehículos" },
        ]} />}
        actions={<VehicleActions worksites={worksitesList.map((w) => ({ id: w.id, name: w.name }))} users={usersList.map((u) => ({ id: u.id, name: u.name }))} equipmentTypes={formEquipmentTypes} suppliers={formSuppliers} products={formProducts} />}
      />
      <VehicleCatalogTable
        vehicles={vehicles.map((v) => ({ ...v, compatibleProductIds: productIdsByVehicle.get(v.id) ?? [], type: v.equipmentType?.name ?? v.type, equipmentTypeName: v.equipmentType?.name ?? v.type, usualFuelSupplierName: v.usualFuelSupplier?.name ?? null, worksiteName: v.worksite?.name ?? null, responsibleName: v.responsibleUser?.name ?? null }))}
        worksites={worksitesList.map((w) => ({ id: w.id, name: w.name }))}
        users={usersList.map((u) => ({ id: u.id, name: u.name }))}
        equipmentTypes={formEquipmentTypes}
        suppliers={formSuppliers}
        products={formProducts}
      />
    </PageContainer>
  )
}
