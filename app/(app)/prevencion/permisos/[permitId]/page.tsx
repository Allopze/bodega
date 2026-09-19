import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { evaluatePermitReadiness, getWorkPermitDetail } from "@/lib/services/prevention-permits"
import { preventionAckPath } from "@/lib/services/prevention-ack-token"
import { PermitDetail } from "./permit-detail"

export const metadata: Metadata = { title: "Permiso de trabajo" }

export default async function PermisoPage({ params }: { params: Promise<{ permitId: string }> }) {
  const { permitId } = await params

  let auth
  try { auth = await requirePermission("prevention:permits:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/permisos")}`) }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await getWorkPermitDetail(permitId, access)
  if (!detail) notFound()

  const readiness = await evaluatePermitReadiness(permitId, access)

  return (
    <PageContainer>
      <PageHeader
        title={`${detail.typeName} · ${detail.permit.code}`}
        description={`${detail.worksiteName} · ${detail.permit.location}`}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Permisos de trabajo", href: "/prevencion/permisos" },
          { label: detail.permit.code },
        ]} />}
      />
      <PermitDetail
        permit={{
          id: detail.permit.id,
          code: detail.permit.code,
          status: detail.permit.status,
          taskDescription: detail.permit.taskDescription,
          location: detail.permit.location,
          riskEntryId: detail.permit.riskEntryId,
          plannedStartAt: detail.permit.plannedStartAt,
          plannedEndAt: detail.permit.plannedEndAt,
          extendedUntilAt: detail.permit.extendedUntilAt,
          extensionReason: detail.permit.extensionReason,
          rejectionReason: detail.permit.rejectionReason,
          suspensionReason: detail.permit.suspensionReason,
          closureSummary: detail.permit.closureSummary,
          cancellationReason: detail.permit.cancellationReason,
          requestedByUserId: detail.permit.requestedByUserId,
          version: detail.permit.version,
        }}
        typeName={detail.typeName}
        typeCode={detail.typeCode}
        requiresIsolation={detail.requiresIsolation}
        requiresMeasurement={detail.requiresMeasurement}
        requiresJsa={detail.requiresJsa}
        maxDurationHours={detail.maxDurationHours}
        worksiteName={detail.worksiteName}
        supervisorName={detail.supervisorName}
        requesterName={detail.requesterName}
        controls={detail.controls.map((item) => ({
          id: item.id,
          description: item.description,
          isMandatory: item.isMandatory,
          verified: item.verified,
          notApplicableReason: item.notApplicableReason,
        }))}
        isolations={detail.isolations.map((item) => ({
          id: item.id,
          energySource: item.energySource,
          equipmentTag: item.equipmentTag,
          isolationMethod: item.isolationMethod,
          lockTagId: item.lockTagId,
          appliedAt: item.appliedAt,
          verifiedZeroEnergy: item.verifiedZeroEnergy,
          removedAt: item.removedAt,
        }))}
        measurements={detail.measurements.map((item) => ({
          id: item.id,
          parameter: item.parameter,
          value: item.value,
          unit: item.unit,
          acceptableMin: item.acceptableMin,
          acceptableMax: item.acceptableMax,
          withinRange: item.withinRange,
          equipmentTag: item.equipmentTag,
          takenAt: item.takenAt,
        }))}
        jsaSteps={detail.jsaSteps.map((item) => ({
          stepOrder: item.stepOrder,
          stepDescription: item.stepDescription,
          hazards: item.hazards as string[],
          controls: item.controls as string[],
          residualRisk: item.residualRisk,
        }))}
        crew={detail.crew.map((item) => ({
          id: item.id,
          workerName: `${item.workerLastName}, ${item.workerFirstName}`,
          role: item.role,
          acknowledgedAt: item.acknowledgedAt,
          crewUserId: item.crewUserId,
          /**
           * PER-002 (auditoría 2026-09-14): enlace de acuse para el integrante
           * SIN cuenta de usuario. Antes no había nada que entregarle: el acuse
           * exigía sesión, así que su fila decía "Pendiente" para siempre y —con
           * el bloqueador de PER-001— el permiso no podía activarse nunca.
           * Sólo se emite para quien no tiene cuenta y aún no acusó.
           */
          ackLink: !item.crewUserId && !item.acknowledgedAt
            ? preventionAckPath("permiso", item.id)
            : null,
        }))}
        readiness={readiness}
        currentUserId={auth.user.id}
        canRequest={auth.user.permissions.includes("prevention:permits:request")}
        canVerify={auth.user.permissions.includes("prevention:permits:verify")}
        canApprove={auth.user.permissions.includes("prevention:permits:approve")}
        canActivate={auth.user.permissions.includes("prevention:permits:activate")}
        canSuspend={auth.user.permissions.includes("prevention:permits:suspend")}
        canClose={auth.user.permissions.includes("prevention:permits:close")}
      />
    </PageContainer>
  )
}
