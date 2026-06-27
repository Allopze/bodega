import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelVehicles, worksites } from "@/db/schema"
import { inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { VehicleCatalogTable } from "./vehicle-table"
import { NewVehicleDialog } from "./new-vehicle-dialog"

export default async function VehiculosPage() {
  let session
  try { session = await requirePermission("combustibles:manage_vehicles") }
  catch { redirect("/forbidden") }

  const worksiteScope = resolveWorksiteScope(session)
  const [vehicles, worksitesList] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      with: { worksite: true },
      orderBy: [fuelVehicles.plate],
    }),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
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
