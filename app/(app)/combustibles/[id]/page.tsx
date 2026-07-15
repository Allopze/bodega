import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, fuelSuppliers, worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { can, requirePermission, canAccessWorksite } from "@/lib/auth/can"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { EditFuelLoadForm } from "./edit-fuel-load-form"

export default async function FuelLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const [load, vehicles, suppliersList, worksitesList] = await Promise.all([
    db.query.fuelLoads.findFirst({
      where: eq(fuelLoads.id, id),
      with: { vehicle: true, supplier: true, worksite: true },
    }),
    db.query.fuelVehicles.findMany({
      where: buildFuelVehiclesWhere(session),
      orderBy: [fuelVehicles.plate],
    }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({
      where: worksiteScopeSql(session, worksites.id),
      orderBy: [worksites.name],
    }),
  ])

  if (!load) notFound()
  if (!canAccessWorksite(session, load.worksiteId)) notFound()

  return (
    <PageContainer>
      <PageHeader
        title={`Carga — ${load.receiptNumber ?? "Sin número"}`}
        description={`${load.loadDate} · ${load.serviceType} · ${load.vehicle?.plate ?? "—"}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: `Carga ${load.receiptNumber ?? load.id.slice(0, 8)}` }]} />}
        actions={can(session, "combustibles:view_audit") ? <Button asChild variant="secondary" size="sm"><Link href={`/combustibles/bitacora/historial/fuel_load/${load.id}`}>Ver auditoría</Link></Button> : undefined}
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
