import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelVehicles, worksites, users } from "@/db/schema"
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
  const [vehicles, worksitesList, usersList] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      with: { worksite: true, responsibleUser: true },
      orderBy: [fuelVehicles.plate],
    }),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
    db.query.users.findMany({ where: eq(users.isActive, true), orderBy: [users.name] }),
  ])

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Vehículos de combustible"
        description="Catálogo administrativo de vehículos que cargan combustible."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de flota", href: "/admin/flota-catalogos" },
          { label: "Vehículos" },
        ]} />}
        actions={<VehicleActions worksites={worksitesList.map((w) => ({ id: w.id, name: w.name }))} users={usersList.map((u) => ({ id: u.id, name: u.name }))} />}
      />
      <VehicleCatalogTable
        vehicles={vehicles.map((v) => ({ ...v, worksiteName: v.worksite?.name ?? null, responsibleName: v.responsibleUser?.name ?? null }))}
        worksites={worksitesList.map((w) => ({ id: w.id, name: w.name }))}
        users={usersList.map((u) => ({ id: u.id, name: u.name }))}
      />
    </PageContainer>
  )
}
