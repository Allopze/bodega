import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelMonthlyStatements } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { fuelMonthLabel, getStatementDisplayStatus, statementPendingAmount } from "@/lib/combustibles/calculations"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { todayInChile } from "@/lib/utils"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddPaymentDialog, StatementDetail } from "../../../cuenta-corriente/[id]/statement-detail"

export const metadata: Metadata = { title: "Estado de cuenta" }

/**
 * Detalle de un estado de cuenta. El `layout.tsx` de esta carpeta ya comprobó el
 * permiso y que el registro exista (404 real); aquí se vuelve a exigir el mismo
 * contrato (global y con costos) porque la página no debe depender de que alguien
 * más lo haya hecho.
 */
export default async function EstadoCuentaPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.pagos); assertFuelCostAccess(session, { global: true }) } catch { redirect("/forbidden") }
  const { id } = await params

  const statement = await db.query.fuelMonthlyStatements.findFirst({
    where: eq(fuelMonthlyStatements.id, id),
    with: {
      supplier: true,
      payments: true,
      loads: { with: { vehicle: true, worksite: true } },
    },
  })
  if (!statement) notFound()

  const today = todayInChile()
  const supplierName = statement.supplier?.name ?? "Proveedor"
  const displayStatus = getStatementDisplayStatus(statement, today)
  const pending = statementPendingAmount(statement)
  const canPay = can(session, "combustibles:manage_statements") && displayStatus !== "paid" && displayStatus !== "cancelled" && pending > 0
  const payments = [...statement.payments].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
  const loads = [...statement.loads].sort((a, b) => a.loadDate.localeCompare(b.loadDate))

  return (
    <PageContainer>
      <PageHeader
        title={`${supplierName} · ${fuelMonthLabel(statement.month).toLowerCase()}`}
        description={`Estado de cuenta · ${loads.length} ${loads.length === 1 ? "carga" : "cargas"}`}
        breadcrumb={
          <FuelBreadcrumbs items={[
            { label: "Pagos", href: FUEL_PATHS.pagos },
            { label: "Estados de cuenta", href: FUEL_PATHS.estados },
            { label: `${supplierName} ${fuelMonthLabel(statement.month).toLowerCase()}` },
          ]} />
        }
        actions={
          <FuelHeaderActions>
            {canPay && <AddPaymentDialog statementId={statement.id} pendingAmount={pending} />}
          </FuelHeaderActions>
        }
      />
      <StatementDetail statement={{ ...statement, payments, loads }} today={today} />
    </PageContainer>
  )
}
