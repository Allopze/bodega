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
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/combustibles")}`) }

  // Esta ficha no es sólo de «Facturas y pagos»: la bitácora (`view`) enlaza aquí
  // desde cada fila facturada y el ciclo físico también. Cerrarla a `view_costs`
  // mandaría a /forbidden a quien llegó desde una pantalla suya, así que sin
  // costos se REDACTA: los montos no viajan al cliente (no basta con ocultarlos,
  // el payload de un componente cliente es legible) y la ficha queda en lectura,
  // con la corrección de medidor, que no toca dinero. Con costos y `create` es el
  // formulario completo de siempre. Las acciones aplican el mismo contrato.
  const canViewCosts = can(session, "combustibles:view_costs")
  const canWrite = can(session, "combustibles:create")

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

  // Objeto explícito, no la fila con sus relaciones: lo que se pasa a un
  // componente cliente se serializa entero. Sin `view_costs` los seis montos
  // salen en 0 y el formulario ni los pinta.
  const zeroUnlessCosts = (amount: number) => (canViewCosts ? amount : 0)
  const loadForForm = {
    id: load.id,
    loadDate: load.loadDate,
    month: load.month,
    serviceType: load.serviceType,
    vehicleId: load.vehicleId,
    fuelSupplierId: load.fuelSupplierId,
    worksiteId: load.worksiteId,
    product: load.product,
    receiptNumber: load.receiptNumber,
    odometerReading: load.odometerReading,
    hourMeterReading: load.hourMeterReading,
    liters: load.liters,
    iecFixed: zeroUnlessCosts(load.iecFixed),
    iecVariable: zeroUnlessCosts(load.iecVariable),
    baseAmount: zeroUnlessCosts(load.baseAmount),
    iecTotal: zeroUnlessCosts(load.iecTotal),
    ivaAmount: zeroUnlessCosts(load.ivaAmount),
    totalAmount: zeroUnlessCosts(load.totalAmount),
    status: load.status,
    notes: load.notes,
    meterReplaced: load.meterReplaced,
    meterReplacementReason: load.meterReplacementReason,
  }

  return (
    <PageContainer>
      <PageHeader
        title={`Carga: ${load.receiptNumber ?? "Sin número"}`}
        description={`${load.loadDate} · ${load.serviceType} · ${load.vehicle?.plate ?? "—"}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          // Sin costos «Facturas y pagos» los manda a /forbidden: su lista es «Cargas».
          canViewCosts ? { label: "Facturas y pagos", href: "/combustibles/facturas" } : { label: "Cargas", href: "/combustibles/bitacora" },
          { label: `Carga ${load.receiptNumber ?? load.id.slice(0, 8)}` },
        ]} />}
        actions={can(session, "combustibles:view_audit") ? <Button asChild variant="secondary" size="sm"><Link href={`/combustibles/bitacora/historial/fuel_load/${load.id}`}>Ver auditoría</Link></Button> : undefined}
      />

      <EditFuelLoadForm
        load={loadForForm}
        showCosts={canViewCosts}
        canWrite={canWrite}
        vehicles={vehicles.map(v => ({ id: v.id, plate: v.plate, type: v.type }))}
        suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))}
        worksites={worksitesList.map(w => ({ id: w.id, name: w.name }))}
      />
    </PageContainer>
  )
}
