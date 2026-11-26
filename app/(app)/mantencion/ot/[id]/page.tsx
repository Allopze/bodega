import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { OtActions } from "@/components/mantencion/jefatura/ot/ot-actions"
import { OtAside } from "@/components/mantencion/jefatura/ot/ot-aside"
import { equipmentText, workOrderTypeText } from "@/components/mantencion/jefatura/ot/ot-labels"
import {
  OtHeaderSection, OtItemsSection, OtObservationsSection, OtPartsRequestsSection, OtProgressSection, OtRejectionNotice, OtRepairSection, OtWorkPerformedSection,
  OtTransferredNotice, OtVoidedNotice,
} from "@/components/mantencion/jefatura/ot/ot-sections"
import { reservedUnusedNotice } from "@/components/mantencion/jefatura/notas-pedido/reserved-unused"
import { can, canAny, requireAnyPermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { loadWorkOrderPartsOverview } from "@/lib/services/mantencion/parts-notes/query"
import { loadWorkOrderRecordForm } from "@/lib/services/mantencion/web-record"
import { listAssignableMechanics, listExecutionWorksiteOptions, loadWorkOrderDetail, loadWorkOrderEntryCatalogs } from "@/lib/services/mantencion/work-orders/query"
import { getOperationalSettings } from "@/lib/services/system-settings"

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
  // «Pedir repuestos» precarga equipo, faena y OT en la solicitud (contrato de `/solicitudes/nueva`). Sólo con
  // permiso para crear y mientras la OT siga abierta: una cerrada o anulada ya no recibe repuestos. La solicitud
  // vuelve a validarlo; esto sólo decide si se ofrece. Con `view_own` el enlace a una solicitud ajena daría 404,
  // así que el código sólo es enlace con `view_all`.
  const partsRequestHref = can(session, "repuestos:create") && detail.status !== "cerrada" && detail.status !== "anulada"
    ? `/solicitudes/nueva?tipo=repuestos&ot=${detail.id}`
    : null
  const canOpenRequests = can(session, "repuestos:view_all")
  // El nombre del repuesto enlaza a su ficha del catálogo sólo con `repuestos:catalog` (la ficha lo exige en el servidor).
  const canOpenSpareParts = can(session, "repuestos:catalog")
  // Los catálogos sólo se consultan cuando el usuario puede usarlos.
  const needsClassificationForm = detail.canEditRequest || detail.canReclassify
  // Notas de pedido de la OT: quien las ve en la bandeja las abre desde aquí; quien administra libera reservas.
  const canOpenNotes = canAny(session, "mant:np:view_worksite", "mant:np:manage")
  const canManageNotes = can(session, "mant:np:manage")
  // El resumen también alimenta los chips del registro web y el aviso al conformar o anular, así que se pide si se
  // puede ver o registrar. Si falla, la OT se muestra igual con lo de siempre: no se cae la página por esta sección.
  const wantsOverview = canOpenNotes || detail.canRegisterRecord
  const [mechanics, entryCatalogs, recordForm, executionWorksites, settings, partsOverview] = await Promise.all([
    allowed.has("assign") ? listAssignableMechanics() : Promise.resolve(null),
    needsEntryCatalogs ? loadWorkOrderEntryCatalogs() : Promise.resolve(null),
    detail.canRegisterRecord ? loadWorkOrderRecordForm(viewer, detail) : Promise.resolve(null),
    // «Editar solicitud» y «Corregir clasificación» eligen la faena de ejecución y marcan el tipo de acción como obligatorio.
    needsClassificationForm ? listExecutionWorksiteOptions() : Promise.resolve(null),
    needsClassificationForm ? getOperationalSettings() : Promise.resolve(null),
    wantsOverview
      ? loadWorkOrderPartsOverview(viewer, detail.id).catch((error: unknown) => {
          logger.warn("[mantencion-ot] resumen de repuestos falló", error)
          return null
        })
      : Promise.resolve(null),
  ])
  const requestItems = (kind: "anexo" | "mantencion") => detail.items.filter((item) => item.origin === "solicitud" && item.kind === kind).map((item) => item.description)

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
            partsRequestHref={partsRequestHref}
            canEditRequest={detail.canEditRequest}
            canReclassify={detail.canReclassify}
            executionWorksites={executionWorksites}
            actionTypeRequired={settings?.mantencionActionTypeRequired === 1}
            reservedUnused={partsOverview ? reservedUnusedNotice(partsOverview.available) : null}
            availableParts={partsOverview?.available}
            request={{
              equipmentLabel: equipmentText(detail),
              worksiteId: detail.worksiteId,
              worksiteName: detail.worksiteName,
              repair: detail.repair,
              maintenance: detail.maintenance,
              requestDate: detail.requestDate,
              requesterName: detail.requesterName,
              repairDescription: detail.repairDescription,
              observations: detail.observations,
              actionType: detail.actionType,
              specialties: detail.specialties,
              executionWorksiteId: detail.executionWorksiteId,
              annexItems: requestItems("anexo"),
              maintenanceItems: requestItems("mantencion"),
              laborHours: detail.laborHours,
              workPerformed: detail.workPerformed,
              hasExit: detail.exit !== null,
            }}
          />
        )}
      />

      <OtVoidedNotice detail={detail} />
      <OtTransferredNotice detail={detail} />
      <OtRejectionNotice detail={detail} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <OtProgressSection detail={detail} />
          <OtHeaderSection detail={detail} />
          <OtRepairSection detail={detail} />
          <OtItemsSection detail={detail} kind="anexo" />
          <OtItemsSection detail={detail} kind="mantencion" />
          <OtPartsRequestsSection
            detail={detail}
            canOpenRequests={canOpenRequests}
            canOpenSpareParts={canOpenSpareParts}
            partsRequestHref={partsRequestHref}
            overview={partsOverview}
            canOpenNotes={canOpenNotes}
            canManageNotes={canManageNotes}
          />
          <OtWorkPerformedSection detail={detail} />
          <OtObservationsSection detail={detail} />
        </div>
        <OtAside detail={detail} />
      </div>
    </PageContainer>
  )
}
