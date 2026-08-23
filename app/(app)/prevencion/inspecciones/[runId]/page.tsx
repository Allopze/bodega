import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getInspectionRunDetail } from "@/lib/services/prevention-inspections"
import { listWorksiteAssignableUsers } from "@/lib/services/prevention-capa"
import { closingActFromDefinition } from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { InspectionRunDetail } from "./inspection-run-detail"

export const metadata: Metadata = { title: "Inspección" }

export default async function InspeccionPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params

  let auth
  try { auth = await requirePermission("prevention:inspections:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/inspecciones")}`) }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await getInspectionRunDetail(runId, access)
  if (!detail) notFound()

  const canExecute = auth.user.permissions.includes("prevention:inspections:execute")
  // Responsables de la CAPA derivada: gente de la faena, no gente que sepa
  // ejecutar inspecciones. La guarda de esta pantalla ya la puso `canExecute`.
  const assignees = canExecute
    ? await listWorksiteAssignableUsers({ worksiteId: detail.run.worksiteId, scope: access.scope })
    : []
  const definition = detail.definitionSnapshot as unknown as ChecklistDefinition

  return (
    <PageContainer>
      <PageHeader
        title={`${detail.templateName} · ${detail.run.code}`}
        description={`${detail.worksiteName}${detail.run.subjectLabel ? ` · ${detail.run.subjectLabel}` : ""}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
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
          origin: detail.run.origin,
          subjectType: detail.run.subjectType,
          subjectLabel: detail.run.subjectLabel,
          subjectVehicleId: detail.run.subjectVehicleId,
          scheduledFor: detail.run.scheduledFor,
          executedAt: detail.run.executedAt,
          reviewedAt: detail.run.reviewedAt,
          reviewComment: detail.run.reviewComment,
          conformingCount: detail.run.conformingCount,
          partialCount: detail.run.partialCount,
          nonConformingCount: detail.run.nonConformingCount,
          notApplicableCount: detail.run.notApplicableCount,
          compliancePercent: detail.run.compliancePercent,
          executedByUserId: detail.run.executedByUserId,
          closingResult: detail.run.closingResult,
          closingRestrictions: detail.run.closingRestrictions,
          closingSignatures: detail.run.closingSignatures,
          version: detail.run.version,
        }}
        closingAct={closingActFromDefinition(definition)}
        templateKind={detail.templateKind}
        pdtpActivityNumbers={detail.pdtpActivityNumbers ?? []}
        pdtpReviewActivityNumbers={detail.pdtpReviewActivityNumbers ?? []}
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
            // Sin el kind, el cliente ofrecía "Regular" en ítems cumple/no-cumple
            // y el servidor rechazaba la transacción completa recién al guardar.
            kind: item.kind,
            required: item.required ?? false,
            countsForCompliance: section.countsForCompliance ?? true,
            danoPotencial: item.danoPotencial ?? null,
            // B-08: sin las opciones, un ítem `select` no se puede responder.
            options: item.options,
            placeholder: item.placeholder,
          })),
        }))}
        answers={detail.answers.map((item) => ({
          answerId: item.id,
          sectionId: item.sectionId,
          itemId: item.itemId,
          result: item.result,
          comment: item.comment,
          value: item.value,
          evidence: item.evidence.map((file) => ({ id: file.id, path: file.path, caption: file.caption })),
          needsConfirmation: item.needsConfirmation,
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
        canStopVehicle={auth.user.permissions.includes("combustibles:manage_vehicles")}
        canIngest={auth.user.permissions.includes("prevention:inspections:ingest")}
        documents={detail.documents.map((item) => ({
          id: item.id,
          path: item.path,
          caption: item.caption,
          createdAt: item.createdAt,
        }))}
        canExecute={canExecute}
        canReview={auth.user.permissions.includes("prevention:inspections:review")}
        canManage={auth.user.permissions.includes("prevention:inspections:manage")}
      />
    </PageContainer>
  )
}
