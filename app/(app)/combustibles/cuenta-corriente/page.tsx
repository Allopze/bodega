import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { desc } from "drizzle-orm"
import { requirePermission, isGlobalRole } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StatementsTable } from "./statements-table"
import { NewStatementDialog } from "./new-statement-dialog"
import { todayInChile } from "@/lib/utils"

export default async function CuentaCorrientePage() {
  // combustibles:view_costs, no combustibles:view: esta pantalla es deuda,
  // pagos y montos por proveedor de punta a punta — la misma llave que
  // /facturas y /reportes, no la de sólo lectura.
  let session
  try { session = await requirePermission("combustibles:view_costs") }
  catch { redirect("/forbidden") }

  if (!isGlobalRole(session)) redirect("/forbidden")

  const [statements, suppliersList] = await Promise.all([
    db.query.fuelMonthlyStatements.findMany({
      with: { supplier: true, payments: true },
      orderBy: [desc(fuelMonthlyStatements.month)],
    }),
    db.query.fuelSuppliers.findMany({ orderBy: [fuelSuppliers.name] }),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Cuenta corriente de combustible"
        description="Resúmenes mensuales por proveedor y control de pagos"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Cuenta corriente" }]} />}
        actions={
          <div className="flex gap-2">
            <NewStatementDialog suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))} />
          </div>
        }
      />
      <StatementsTable statements={statements} today={todayInChile()} />
    </PageContainer>
  )
}
