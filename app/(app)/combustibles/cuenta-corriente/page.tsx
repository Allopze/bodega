import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelMonthlyStatements, fuelSuppliers } from "@/db/schema"
import { desc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StatementsTable } from "./statements-table"
import { NewStatementDialog } from "./new-statement-dialog"

export default async function CuentaCorrientePage() {
  try { await requirePermission("combustibles:view") }
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
      <Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Cuenta corriente" }]} />
      <PageHeader
        title="Cuenta corriente de combustible"
        description="Resúmenes mensuales por proveedor y control de pagos"
        actions={
          <div className="flex gap-2">
            <NewStatementDialog suppliers={suppliersList.map(s => ({ id: s.id, name: s.name }))} />
          </div>
        }
      />
      <StatementsTable statements={statements} />
    </PageContainer>
  )
}
