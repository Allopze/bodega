import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssetAssignments, itAssets, workers, worksites } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { listAssignments } from "@/lib/services/ti/assignments"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { AssignmentsTable } from "./assignments-table"
import { AssignmentSheet } from "./assignment-sheet"

export const metadata: Metadata = { title: "Asignaciones TI" }

export default async function AsignacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const sp = await searchParams
  const onlyActive = sp.estado === "vigentes"

  const scope = worksiteScopeSql(session, itAssetAssignments.worksiteId)

  const [assignments, workersList, worksitesList, assetOptions] = await Promise.all([
    listAssignments({ status: onlyActive ? "active" : undefined, scope }),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(eq(workers.isActive, true)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    listAssetOptions(worksiteScopeSql(session, itAssets.worksiteId)),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Asignaciones"
        description="Custodia de equipos: entregas, devoluciones y transferencias con evidencia fotográfica y actas."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Asignaciones" }]} />}
        actions={canManage ? (
          <AssignmentSheet
            trigger={
              <Button>
                <Plus size={14} className="mr-1.5" /> Nueva entrega
              </Button>
            }
            workers={workersList}
            worksites={worksitesList}
            assets={assetOptions}
          />
        ) : undefined}
      />

      <div className="mb-4 flex items-center gap-2">
        <Link href="/ti/asignaciones" className={`rounded-full px-3 py-1 text-xs font-semibold ${!onlyActive ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
          Todas
        </Link>
        <Link href="/ti/asignaciones?estado=vigentes" className={`rounded-full px-3 py-1 text-xs font-semibold ${onlyActive ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
          Vigentes
        </Link>
      </div>

      <AssignmentsTable
        rows={assignments}
        canManage={canManage}
        workers={workersList}
        worksites={worksitesList}
      />
    </PageContainer>
  )
}
