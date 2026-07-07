import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { NewFuelLoadForm } from "./new-fuel-load-form"

export default async function NuevaCargaPage() {
  try { await requirePermission("combustibles:create") }
  catch { redirect("/forbidden") }

  const [vehicles, suppliers, worksitesList] = await Promise.all([
    db.query.fuelVehicles.findMany({ orderBy: [fuelVehicles.plate] }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({ orderBy: [worksites.name] }),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Nueva carga de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Nueva carga" }]} />}
      />
      <NewFuelLoadForm
        data={{
          vehicles: vehicles.map(v => ({ id: v.id, plate: v.plate, type: v.type })),
          suppliers: suppliers.map(s => ({ id: s.id, name: s.name })),
          worksites: worksitesList.map(w => ({ id: w.id, name: w.name })),
        }}
      />
    </PageContainer>
  )
}
