import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listPermitSupervisors,
  listPermitTypes,
  listPermitWorkers,
  listPermitWorksites,
  listWorkPermits,
} from "@/lib/services/prevention-permits"
import { WorkPermitList } from "./work-permit-list"

export const metadata: Metadata = { title: "Permisos de trabajo" }

export default async function PermisosPage() {
  let session
  try { session = await requirePermission("prevention:permits:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:permits:manage")
  const canRequest = session.user.permissions.includes("prevention:permits:request")

  const [permits, types, worksites, workers, supervisors] = await Promise.all([
    listWorkPermits(access),
    listPermitTypes(access),
    // La alta de tipo/permiso sólo la necesita quien puede administrar o
    // solicitar: para el resto son consultas sobre catálogo y dotación que
    // nadie va a mirar.
    canManage || canRequest ? listPermitWorksites(access) : Promise.resolve([]),
    canRequest ? listPermitWorkers(access) : Promise.resolve([]),
    canRequest ? listPermitSupervisors(access) : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Permisos de trabajo"
        description="Autorización de tareas críticas con AST, controles verificados, aislamiento de energías y cuadrilla habilitada."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Permisos de trabajo" },
        ]} />}
        actions={
          session.user.permissions.includes("prevention:permits:export") ? (
            <Button asChild variant="secondary">
              <a href="/api/prevencion/permisos/export" download>Exportar Excel</a>
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
        canManage={canManage}
        canRequest={canRequest}
        types={types.flatMap((item) => item.isActive ? [{
          id: item.id,
          code: item.code,
          name: item.name,
          competencyTaskKey: item.competencyTaskKey,
          requiresIsolation: item.requiresIsolation,
          requiresMeasurement: item.requiresMeasurement,
          requiresJsa: item.requiresJsa,
          maxDurationHours: item.maxDurationHours,
        }] : [])}
        worksites={worksites}
        workers={workers.map((worker) => ({
          id: worker.id,
          name: `${worker.lastName}, ${worker.firstName}`,
          position: worker.position,
          worksiteId: worker.worksiteId,
        }))}
        supervisors={supervisors}
      />
    </PageContainer>
  )
}
