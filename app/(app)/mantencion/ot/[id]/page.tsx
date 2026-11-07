import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { OtActions } from "@/components/mantencion/jefatura/ot/ot-actions"
import { OtAside } from "@/components/mantencion/jefatura/ot/ot-aside"
import { equipmentText, workOrderTypeText } from "@/components/mantencion/jefatura/ot/ot-labels"
import {
  OtEntrySection, OtExitSection, OtFaenaReceptionSection, OtHeaderSection, OtItemsSection, OtObservationsSection,
  OtReceptionSection, OtRejectionNotice, OtRepairSection, OtVoidedNotice,
} from "@/components/mantencion/jefatura/ot/ot-sections"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadWorkOrderRecordForm } from "@/lib/services/mantencion/web-record"
import { listAssignableMechanics, loadWorkOrderDetail, loadWorkOrderEntryCatalogs } from "@/lib/services/mantencion/work-orders/query"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Orden de trabajo" }

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"], "/mantencion/ot")
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  // `null` cubre «no existe» y «fuera de tu alcance»: el mismo 404, sin confirmar que el id existe.
  const viewer = viewerFromSession(session)
  const detail = await loadWorkOrderDetail(viewer, id)
  if (!detail) notFound()

  const allowed = new Set(detail.allowedTransitions)
  const needsEntryCatalogs = allowed.has("start") || (detail.canEditExecution && !!detail.entry)
  // El PDF y la hoja imprimible exigen ver la OT (expone el trabajo enlazado): el
  // mecánico que sólo ejecuta ve la OT y sus acciones, pero no el botón de descarga.
  const canDownloadPdf = can(session, "mant:ot:view_worksite") || can(session, "mant:ot:view_all")
  // Los catálogos sólo se consultan cuando el usuario puede usarlos.
  const [mechanics, entryCatalogs, recordForm] = await Promise.all([
    allowed.has("assign") ? listAssignableMechanics() : Promise.resolve(null),
    needsEntryCatalogs ? loadWorkOrderEntryCatalogs() : Promise.resolve(null),
    detail.canRegisterRecord ? loadWorkOrderRecordForm(viewer, detail) : Promise.resolve(null),
  ])

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`${detail.folio} · ${equipmentText(detail)}`}
        description={`${workOrderTypeText(detail)} · ${detail.worksiteName}`}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Órdenes de trabajo", href: "/mantencion/ot" },
          { label: detail.folio },
        ]}
        actions={(
          <OtActions
            workOrderId={detail.id}
            folio={detail.folio}
            version={detail.version}
            status={detail.status}
            allowedTransitions={detail.allowedTransitions}
            canEditExecution={detail.canEditExecution}
            unit={detail.unit}
            entry={detail.entry}
            estimatedDeliveryDate={detail.estimatedDeliveryDate}
            items={detail.items}
            assignedToUserId={detail.assignedToUserId}
            mechanics={mechanics}
            entryCatalogs={entryCatalogs}
            actorName={session.user.name ?? ""}
            actorUserId={session.user.id}
            pdfHref={`/api/mantencion/ot/${detail.id}/pdf`}
            canDownloadPdf={canDownloadPdf}
            repair={detail.repair}
            maintenance={detail.maintenance}
            needsLinkedRecord={detail.needsLinkedRecord}
            recordForm={recordForm}
          />
        )}
      />

      <OtVoidedNotice detail={detail} />
      <OtRejectionNotice detail={detail} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <OtHeaderSection detail={detail} />
          <OtRepairSection detail={detail} />
          <OtItemsSection detail={detail} kind="anexo" />
          <OtItemsSection detail={detail} kind="mantencion" />
          <OtObservationsSection detail={detail} />
          <OtEntrySection detail={detail} />
          <OtExitSection detail={detail} />
          <OtReceptionSection detail={detail} />
          <OtFaenaReceptionSection detail={detail} />
        </div>
        <OtAside detail={detail} showCosts={canDownloadPdf} />
      </div>
    </PageContainer>
  )
}
