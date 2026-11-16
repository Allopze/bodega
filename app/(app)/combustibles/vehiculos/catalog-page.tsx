import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { loadPadronMaintenance } from "@/lib/services/mantencion/padron-identity"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { loadVehicleFormCatalogs } from "./form-catalogs"
import { VehicleActions } from "./vehicle-actions"
import { VehicleCatalogTable } from "./vehicle-table"

export async function FuelVehiclesCatalogPage() {
  let session
  // Padrón, no operación: ver la nota en `actions-module/vehicles.ts`.
  try { session = await requirePermission("admin:fleet_vehicles") }
  catch { redirect("/forbidden") }

  const [vehicles, catalogs, compatibility, maintenance] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      with: { worksite: true, responsibleUser: true, equipmentType: true, usualFuelSupplier: true },
      orderBy: [fuelVehicles.plate],
    }),
    loadVehicleFormCatalogs(session),
    db.query.fuelVehicleProducts.findMany(),
    // Los que están en Mantención se editan con sus reglas (crítica 2026-11-15, paso 4b).
    loadPadronMaintenance(session),
  ])
  const { worksites: formWorksites, users: formUsers, equipmentTypes: formEquipmentTypes, suppliers: formSuppliers, products: formProducts } = catalogs
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
        actions={<VehicleActions worksites={formWorksites} users={formUsers} equipmentTypes={formEquipmentTypes} suppliers={formSuppliers} products={formProducts} />}
      />
      <VehicleCatalogTable
        vehicles={vehicles.map((v) => ({ ...v, maintenance: maintenance.byVehicle[v.id] ?? null, compatibleProductIds: productIdsByVehicle.get(v.id) ?? [], type: v.equipmentType?.name ?? v.type, equipmentTypeName: v.equipmentType?.name ?? v.type, usualFuelSupplierName: v.usualFuelSupplier?.name ?? null, worksiteName: v.worksite?.name ?? null, responsibleName: v.responsibleUser?.name ?? null }))}
        worksites={formWorksites}
        users={formUsers}
        equipmentTypes={formEquipmentTypes}
        suppliers={formSuppliers}
        products={formProducts}
        maintenanceBrands={maintenance.brands}
      />
    </PageContainer>
  )
}
