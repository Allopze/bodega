import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getChangeRequestDetail, listChangeAssignees } from "@/lib/services/prevention-change"
import { ChangeDetail } from "./change-detail"

export const metadata: Metadata = { title: "Gestión del cambio" }

export default async function CambioPage({ params }: { params: Promise<{ changeId: string }> }) {
  const { changeId } = await params

  let auth
  try { auth = await requirePermission("prevention:change:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/gestion-cambio")}`) }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await getChangeRequestDetail(changeId, access)
  if (!detail) notFound()

  const canEvaluate = auth.user.permissions.includes("prevention:change:evaluate")
  const canApprove = auth.user.permissions.includes("prevention:change:approve")
  const assignees = canEvaluate ? await listChangeAssignees(access) : []

  return (
    <PageContainer>
      <PageHeader
        title={detail.request.title}
        description={`${detail.request.code} · ${detail.worksiteName}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Gestión del cambio", href: "/prevencion/gestion-cambio" },
          { label: detail.request.title },
        ]} />}
      />
      <ChangeDetail
        request={{
          id: detail.request.id,
          code: detail.request.code,
          title: detail.request.title,
          changeType: detail.request.changeType,
          description: detail.request.description,
          reason: detail.request.reason,
          riskLevel: detail.request.riskLevel,
          status: detail.request.status,
          plannedReviewDate: detail.request.plannedReviewDate,
          rejectedReason: detail.request.rejectedReason,
          requestedByUserId: detail.request.requestedByUserId,
          version: detail.request.version,
        }}
        worksiteName={detail.worksiteName}
        readiness={detail.readiness}
        assessments={detail.assessments.map((row) => ({
          id: row.id,
          dimension: row.dimension,
          evaluated: row.evaluated,
          impacted: row.impacted,
          notes: row.notes,
          actionRequired: row.actionRequired,
          capaActionId: row.capaActionId,
        }))}
        assignees={assignees}
        currentUserId={auth.user.id}
        canEvaluate={canEvaluate}
        canApprove={canApprove}
      />
    </PageContainer>
  )
}
