import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelSuppliers, fuelVehicles, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { getFuelIecRates } from "@/lib/services/system-settings"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { invoiceEquipmentLabel } from "../invoice-params"
import { NewFuelLoadForm } from "./new-fuel-load-form"

export const metadata: Metadata = { title: "Nueva factura" }

export default async function NuevaFacturaPage() {
  let session
  try {
    // El formulario captura y calcula boleta, IEC e IVA, y vive en «Pagos»
    // (`view_costs`): crear exige además ver costos. `createFuelLoadAction`
    // aplica el mismo contrato; esta guarda sólo evita mostrar un formulario que
    // el servidor rechazaría.
    session = await requirePermission("combustibles:create", FUEL_PATHS.pagos)
    assertFuelCostAccess(session)
  } catch { redirect("/forbidden") }

  // Sólo equipos y proveedores activos, y faenas dentro del alcance de la sesión:
  // el servidor no rechaza una carga contra un equipo desactivado ni contra una
  // faena ajena, así que el formulario no debe ofrecerlos.
  const [vehicles, suppliers, worksitesList, rates] = await Promise.all([
    db.query.fuelVehicles.findMany({
      where: and(eq(fuelVehicles.isActive, true), worksiteScopeSql(session, fuelVehicles.worksiteId)),
      orderBy: [fuelVehicles.plate],
    }),
    db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), orderBy: [fuelSuppliers.name] }),
    db.query.worksites.findMany({ where: worksiteScopeSql(session, worksites.id), orderBy: [worksites.name] }),
    getFuelIecRates(),
  ])

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nueva factura"
        description="Registra una carga facturada con su neto, IEC e IVA"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Pagos", href: FUEL_PATHS.pagos }, { label: "Nueva factura" }]} />}
        actions={<FuelHeaderActions />}
      />
      <NewFuelLoadForm
        data={{
          vehicles: vehicles.map((v) => ({ value: v.id, label: invoiceEquipmentLabel(v), hint: v.type })),
          suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
          worksites: worksitesList.map((w) => ({ id: w.id, name: w.name })),
        }}
        rates={rates}
      />
    </PageContainer>
  )
}
