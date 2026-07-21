import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getInspectionRunDetail, listInspectionAssignees } from "@/lib/services/prevention-inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { InspectionRunDetail } from "./inspection-run-detail"

export const metadata: Metadata = { title: "Inspección" }

export default async function InspeccionPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params

  let auth
  try { auth = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await getInspectionRunDetail(runId, access)
  if (!detail) notFound()

  const canExecute = auth.user.permissions.includes("prevention:inspections:execute")
  const assignees = canExecute ? await listInspectionAssignees(access) : []
  const definition = detail.definitionSnapshot as unknown as ChecklistDefinition

  return (
    <PageContainer>
      <PageHeader
        title={`${detail.templateName} · ${detail.run.code}`}
        description={`${detail.worksiteName}${detail.run.subjectLabel ? ` · ${detail.run.subjectLabel}` : ""}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Inspecciones", href: "/prevencion/inspecciones" },
          { label: detail.run.code },
        ]} />}
      />
      <InspectionRunDetail
        run={{
          id: detail.run.id,
          code: detail.run.code,
          status: detail.run.status,
          subjectType: detail.run.subjectType,
          subjectLabel: detail.run.subjectLabel,
          scheduledFor: detail.run.scheduledFor,
          executedAt: detail.run.executedAt,
          reviewedAt: detail.run.reviewedAt,
          reviewComment: detail.run.reviewComment,
          conformingCount: detail.run.conformingCount,
          nonConformingCount: detail.run.nonConformingCount,
          notApplicableCount: detail.run.notApplicableCount,
          compliancePercent: detail.run.compliancePercent,
          executedByUserId: detail.run.executedByUserId,
          version: detail.run.version,
        }}
        templateKind={detail.templateKind}
        worksiteName={detail.worksiteName}
        assigneeName={detail.assigneeName}
        executorName={detail.executorName}
        reviewerName={detail.reviewerName}
        sections={definition.sections.map((section) => ({
          id: section.id,
          title: section.title,
          items: section.items.map((item) => ({
            id: item.id,
            label: item.label,
            required: item.required ?? false,
            countsForCompliance: section.countsForCompliance ?? true,
            danoPotencial: item.danoPotencial ?? null,
          })),
        }))}
        answers={detail.answers.map((item) => ({
          sectionId: item.sectionId,
          itemId: item.itemId,
          result: item.result,
          comment: item.comment,
        }))}
        findings={detail.findings.map((item) => ({
          id: item.id,
          description: item.description,
          criticality: item.criticality,
          status: item.status,
          capaActionId: item.capaActionId,
        }))}
        currentUserId={auth.user.id}
        assignees={assignees}
        canExecute={canExecute}
        canReview={auth.user.permissions.includes("prevention:inspections:review")}
      />
    </PageContainer>
  )
}
