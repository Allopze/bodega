import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelVehicles, worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { VehicleCatalogTable } from "./vehicle-table"
import { NewVehicleDialog } from "./new-vehicle-dialog"

export default async function VehiculosPage() {
  try { await requirePermission("combustibles:manage_vehicles") }
  catch { redirect("/forbidden") }

  const [vehicles, worksitesList] = await Promise.all([
    db.query.fuelVehicles.findMany({
      with: { worksite: true },
      orderBy: [fuelVehicles.plate],
    }),
    db.query.worksites.findMany({ orderBy: [worksites.name] }),
  ])

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Vehículos" }]} />
      <PageHeader
        title="Vehículos de combustible"
        description="Catálogo de vehículos que cargan combustible"
        actions={<NewVehicleDialog worksites={worksitesList.map(w => ({ id: w.id, name: w.name }))} />}
      />
      <VehicleCatalogTable vehicles={vehicles} worksites={worksitesList.map(w => ({ id: w.id, name: w.name }))} />
    </PageContainer>
  )
}
