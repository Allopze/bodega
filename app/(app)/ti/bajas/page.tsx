import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, users } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { listRetirements } from "@/lib/services/ti/retirements"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { RetirementTable } from "./retirement-table"
import { RetirementSheet } from "./retirement-sheet"
import { Button } from "@/components/ui/button"
import { Archive } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Bajas TI" }

export default async function BajasPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const scope = worksiteScopeSql(session, itAssets.worksiteId)

  const [rows, assetOptions, techUsers] = await Promise.all([
    listRetirements({ scope }),
    listAssetOptions(scope),
    db.select({ id: users.id, name: users.name })
      .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name)),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Bajas de activos"
        description="Proceso formal de baja: el activo conserva su historial completo para siempre."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Bajas" }]} />}
        actions={canManage ? (
          <RetirementSheet
            trigger={<Button variant="destructive"><Archive size={14} className="mr-1.5" /> Dar de baja</Button>}
            assets={assetOptions}
            users={techUsers}
          />
        ) : undefined}
      />

      <RetirementTable rows={rows} />
    </PageContainer>
  )
}
