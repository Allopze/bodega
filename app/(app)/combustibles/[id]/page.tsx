import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EditFuelLoadForm } from "./edit-fuel-load-form"

export default async function FuelLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  try { await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const [load, vehicles, suppliersList, worksitesList] = await Promise.all([
    db.query.fuelLoads.findFirst({
      where: eq(fuelLoads.id, id),
      with: { vehicle: true, supplier: true, worksite: true },
    }),
    db.query.fuelVehicles.findMany({ orderBy: [fuelVehicles.plate] }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({ orderBy: [worksites.name] }),
  ])

  if (!load) notFound()

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: `Carga ${load.receiptNumber ?? load.id.slice(0, 8)}` }]} />
      <PageHeader
        title={`Carga — ${load.receiptNumber ?? "Sin número"}`}
        description={`${load.loadDate} · ${load.serviceType} · ${load.vehicle?.plate ?? "—"}`}
      />

      <EditFuelLoadForm
        load={load}
        vehicles={vehicles.map(v => ({ id: v.id, plate: v.plate, type: v.type }))}
        suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))}
        worksites={worksitesList.map(w => ({ id: w.id, name: w.name }))}
      />
    </PageContainer>
  )
}
