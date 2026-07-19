import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listWorkPermits } from "@/lib/services/prevention-permits"
import { WorkPermitList } from "./work-permit-list"

export const metadata: Metadata = { title: "Permisos de trabajo" }

export default async function PermisosPage() {
  let session
  try { session = await requirePermission("prevention:permits:view") }
  catch { redirect("/forbidden") }

  const permits = await listWorkPermits({
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  })

  return (
    <PageContainer>
      <PageHeader
        title="Permisos de trabajo"
        description="Autorización de tareas críticas con AST, controles verificados, aislamiento de energías y cuadrilla habilitada."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Permisos de trabajo" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:permits:export") ? (
            <Button asChild variant="secondary">
              <Link href="/api/prevencion/permisos/export">Exportar XLSX</Link>
            </Button>
          ) : undefined
        }
      />
      <WorkPermitList
        permits={permits.map((row) => ({
          id: row.permit.id,
          code: row.permit.code,
          status: row.permit.status,
          taskDescription: row.permit.taskDescription,
          location: row.permit.location,
          plannedStartAt: row.permit.plannedStartAt,
          plannedEndAt: row.permit.plannedEndAt,
          extendedUntilAt: row.permit.extendedUntilAt,
          suspensionReason: row.permit.suspensionReason,
          worksiteId: row.permit.worksiteId,
          worksiteName: row.worksiteName,
          typeName: row.typeName,
          crewCount: row.crewCount,
          acknowledgedCount: row.acknowledgedCount,
          openIsolationCount: row.openIsolationCount,
        }))}
      />
    </PageContainer>
  )
}
