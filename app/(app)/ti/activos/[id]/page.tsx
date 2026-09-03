import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, itTickets, attachments, users, suppliers } from "@/db/schema"
import { eq, and } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getAssetById } from "@/lib/services/ti/assets"
import { getAssetHistory } from "@/lib/services/ti/history"
import { listAssignments, getAssignmentPhotos, getAssignmentAccessories } from "@/lib/services/ti/assignments"
import { listMaintenances } from "@/lib/services/ti/maintenance"
import { listRetirements } from "@/lib/services/ti/retirements"
import { listAssetTypes } from "@/lib/services/ti/asset-types"
import type { ItAssetFormData } from "@/lib/validation/ti"
import { AssetDetailTabs } from "./asset-detail-tabs"
import { AssetSummary } from "./asset-summary"
import { AssetHistory } from "./asset-history"
import { AssetAssignments } from "./asset-assignments"
import { AssetMaintenance } from "./asset-maintenance"
import { AssetTickets } from "./asset-tickets"
import { AssetDocuments } from "./asset-documents"
import { AssetFormSheet } from "../asset-form-sheet"
import { Button } from "@/components/ui/button"
import { PencilSimple } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Ficha de activo TI" }

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const scope = worksiteScopeSql(session, itAssets.worksiteId)

  const asset = await getAssetById(id, scope)
  if (!asset) notFound()

  const canManage = can(session, "ti:manage_assets")

  const [history, assignments, maintenances, tickets, retirements, assetTypes, suppliersList, worksitesList, workersList] = await Promise.all([
    getAssetHistory(id),
    listAssignments({ assetId: id }),
    listMaintenances({ assetId: id }),
    db.select({
      id: itTickets.id, code: itTickets.code, subject: itTickets.subject,
      status: itTickets.status, priority: itTickets.priority,
      createdAt: itTickets.createdAt, updatedAt: itTickets.updatedAt,
      requesterName: users.name,
    })
      .from(itTickets)
      .leftJoin(users, eq(itTickets.requesterUserId, users.id))
      .where(eq(itTickets.assetId, id))
      .orderBy(itTickets.createdAt),
    listRetirements({ assetId: id }),
    listAssetTypes({ includeInactive: true }),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)),
    db.query.worksites.findMany({
      columns: { id: true, name: true },
      where: (w, { eq }) => eq(w.isActive, true),
    }),
    db.query.workers.findMany({
      columns: { id: true, firstName: true, lastName: true },
      where: (w, { eq }) => eq(w.isActive, true),
    }),
  ])

  // Fotos por asignación para la comparación entrega/devolución.
  const assignmentsWithEvidence = await Promise.all(
    assignments.map(async (assignment) => ({
      ...assignment,
      photos: await getAssignmentPhotos(assignment.id),
      accessories: await getAssignmentAccessories(assignment.id),
    })),
  )

  const documents = await db.select({
    id: attachments.id, fileName: attachments.fileName, mimeType: attachments.mimeType,
    fileSize: attachments.fileSize, uploadedAt: attachments.uploadedAt, uploadedByName: users.name,
  })
    .from(attachments)
    .leftJoin(users, eq(attachments.uploadedBy, users.id))
    .where(and(eq(attachments.entityType, "it_asset"), eq(attachments.entityId, id)))
    .orderBy(attachments.uploadedAt)

  const activeAssignment = assignmentsWithEvidence.find((a) => !a.returnedAt) ?? null

  return (
    <PageContainer>
      <PageHeader
        title={asset.code}
        description={[asset.brand, asset.model].filter(Boolean).join(" ") || asset.typeName}
        breadcrumb={<Breadcrumbs items={[
          { label: "TI", href: "/ti" },
          { label: "Inventario", href: "/ti/activos" },
          { label: asset.code },
        ]} />}
        actions={canManage ? (
          <AssetFormSheet
            trigger={<Button variant="secondary"><PencilSimple size={14} className="mr-1.5" /> Editar</Button>}
            assetTypes={assetTypes}
            suppliers={suppliersList}
            worksites={worksitesList}
            editAsset={{
              id: asset.id,
              code: asset.code,
              assetTypeId: asset.assetTypeId,
              brand: asset.brand ?? "",
              model: asset.model ?? "",
              serialNumber: asset.serialNumber ?? "",
              status: asset.status as ItAssetFormData["status"],
              worksiteId: asset.worksiteId ?? "",
              location: asset.location ?? "",
              purchaseDate: asset.purchaseDate ?? "",
              supplierId: asset.supplierId ?? "",
              purchaseDocType: (asset.purchaseDocType ?? "") as ItAssetFormData["purchaseDocType"],
              purchaseDocRef: asset.purchaseDocRef ?? "",
              cost: asset.cost ?? undefined,
              warrantyEndDate: asset.warrantyEndDate ?? "",
              processor: asset.processor ?? "",
              ram: asset.ram ?? "",
              storage: asset.storage ?? "",
              os: asset.os ?? "",
              observations: asset.observations ?? "",
            }}
          />
        ) : undefined}
      />

      <AssetDetailTabs
        assetId={asset.id}
        summary={<AssetSummary asset={asset} activeAssignment={activeAssignment} canManage={canManage} />}
        assignments={<AssetAssignments assetId={asset.id} rows={assignmentsWithEvidence} activeAssignment={activeAssignment} canManage={canManage} workers={workersList.map((w) => ({ id: w.id, name: w.firstName, lastName: w.lastName }))} worksites={worksitesList} suppliers={suppliersList} />}
        maintenance={<AssetMaintenance assetId={asset.id} rows={maintenances} canManage={canManage} suppliers={suppliersList} />}
        tickets={<AssetTickets rows={tickets} />}
        documents={<AssetDocuments assetId={asset.id} documents={documents} canManage={canManage} />}
        history={<AssetHistory assetId={asset.id} rows={history} retirements={retirements} />}
        counts={{
          assignments: assignments.length,
          maintenance: maintenances.length,
          tickets: tickets.length,
          documents: documents.length,
          history: history.length,
        }}
      />
    </PageContainer>
  )
}
