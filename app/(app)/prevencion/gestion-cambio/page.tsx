import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listChangeRequests, listChangeWorksites } from "@/lib/services/prevention-change"
import { ChangeList } from "./change-list"

export const metadata: Metadata = { title: "Gestión del cambio" }

export default async function GestionCambioPage() {
  let session
  try { session = await requirePermission("prevention:change:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const canManage = session.user.permissions.includes("prevention:change:manage")

  const [changes, worksites] = await Promise.all([
    listChangeRequests(access),
    canManage ? listChangeWorksites(access) : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Gestión del cambio"
        description="Un cambio de proceso, instalación, equipo, sustancia, proveedor, requisito legal, dotación, software o procedimiento evalúa su impacto en riesgos, permisos, capacitación, documentos, MIPER y emergencia antes de aprobarse."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Gestión del cambio" },
        ]} />}
      />
      <ChangeList
        changes={changes.map((row) => ({
          id: row.request.id,
          code: row.request.code,
          title: row.request.title,
          changeType: row.request.changeType,
          status: row.request.status,
          riskLevel: row.request.riskLevel,
          worksiteName: row.worksiteName,
          evaluatedCount: row.evaluatedCount,
        }))}
        worksites={worksites}
        canManage={canManage}
      />
    </PageContainer>
  )
}
