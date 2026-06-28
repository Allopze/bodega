import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelMonthlyStatements } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission, isGlobalRole } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { StatementDetail } from "./statement-detail"

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  if (!isGlobalRole(session)) redirect("/forbidden")

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

  return (
    <PageContainer>
      <PageHeader
        title={`Resumen ${statement.month}`}
        description={`${statement.supplier?.name ?? "Proveedor"} — ${statement.loads?.length ?? 0} cargas`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Combustibles", href: "/combustibles" },
            { label: "Cuenta corriente", href: "/combustibles/cuenta-corriente" },
            { label: `${statement.month} — ${statement.supplier?.name ?? ""}` },
          ]} />
        }
      />
      <StatementDetail statement={statement} />
    </PageContainer>
  )
}
