import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { desc } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StatementsTable } from "./statements-table"
import { NewStatementDialog } from "./new-statement-dialog"
import { todayInChile } from "@/lib/utils"

export default async function CuentaCorrientePage() {
  let session
  try {
    session = await requirePermission("combustibles:view")
    assertFuelCostAccess(session, { global: true })
  }
  catch { redirect("/forbidden") }

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
        actions={can(session, "combustibles:manage_statements") ? (
          <div className="flex gap-2">
            <NewStatementDialog suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))} />
          </div>
        ) : undefined}
      />
      <StatementsTable statements={statements} today={todayInChile()} />
    </PageContainer>
  )
}
