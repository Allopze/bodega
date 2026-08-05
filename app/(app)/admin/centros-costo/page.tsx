import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CostCenterActions } from "./cost-center-actions"
import { CostCenterList } from "./cost-center-list"

export const metadata: Metadata = { title: "Centros de costo" }

export default async function CostCentersPage() {
  let session
  try {
    session = await requirePermission("admin:cost_centers")
  } catch {
    redirect("/forbidden")
  }

  const [rows, wsRows] = await Promise.all([
    db.query.costCenters.findMany({
      with: { worksite: true },
      orderBy: (c, { asc }) => [asc(c.code)],
    }),
    db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
  ])

  const canCreate = (session.user.permissions ?? []).includes("admin:cost_centers")

  return (
    <PageContainer>
      <PageHeader
        title="Centros de costo"
        description="Crea y mantiene centros de costo asociados a faenas e imputaciones."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Centros de costo" },
        ]}
        actions={<CostCenterActions worksites={wsRows.map((w) => ({ id: w.id, name: w.name, code: w.code }))} canCreate={canCreate} />}
      />
      <CostCenterList
        costCenters={rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          worksiteId: r.worksiteId ?? "",
          worksiteName: r.worksite?.name ?? "",
          description: r.description ?? "",
          isActive: r.isActive,
          updatedAt: r.updatedAt,
        }))}
        worksites={wsRows.map((w) => ({ id: w.id, name: w.name, code: w.code }))}
        canCreate={canCreate}
      />
    </PageContainer>
  )
}
