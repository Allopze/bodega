import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { getFuelIecRates } from "@/lib/services/system-settings"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { NewFuelLoadForm } from "./new-fuel-load-form"

export default async function NuevaCargaPage() {
  let session
  try { session = await requirePermission("combustibles:create") }
  catch { redirect("/forbidden") }

  // Antes ofrecía vehículos/proveedores DESACTIVADOS y faenas fuera del
  // alcance del usuario — registrar una carga contra cualquiera de esos tres
  // igual se guardaba (el servidor no lo rechaza).
  const [vehicles, suppliers, worksitesList, rates] = await Promise.all([
    db.query.fuelVehicles.findMany({ where: eq(fuelVehicles.isActive, true), orderBy: [fuelVehicles.plate] }),
    db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({ where: worksiteScopeSql(session, worksites.id), orderBy: [worksites.name] }),
    getFuelIecRates(),
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
        rates={rates}
      />
    </PageContainer>
  )
}
