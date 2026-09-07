import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, itTickets, users, suppliers, workers, worksites } from "@/db/schema"
import { eq, and } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getAssetById } from "@/lib/services/ti/assets"
import { getAssetHistory } from "@/lib/services/ti/history"
import { listAssignments, getAssignmentsPhotos, getAssignmentsAccessories } from "@/lib/services/ti/assignments"
import { listMaintenances } from "@/lib/services/ti/maintenance"
import { listRetirements } from "@/lib/services/ti/retirements"
import { listAssetTypes } from "@/lib/services/ti/asset-types"
import { listTiAttachments } from "@/lib/services/ti/attachments"
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
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteListScope = worksiteScopeSql(session, worksites.id)

  const asset = await getAssetById(id, scope)
  if (!asset) notFound()

  const canManage = can(session, "ti:manage_assets")
  // Registrar, editar y anular mantenciones tiene su propio permiso: sin esto,
  // un rol con `ti:manage_assets` pero sin `ti:manage_maintenance` veía los
  // botones y recibía "Sin permisos" recién al enviar el formulario.
  const canManageMaintenance = can(session, "ti:manage_maintenance")

  const [history, assignments, maintenances, tickets, retirements, assetTypes, suppliersList, worksitesList, workersList, documents] = await Promise.all([
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
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteListScope)),
    db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)),
    listTiAttachments("it_asset", id),
  ])

  // Fotos y accesorios por asignación para la comparación entrega/devolución,
  // en lote (2 queries totales en vez de 2 por asignación).
  const assignmentIds = assignments.map((a) => a.id)
  const [photosByAssignment, accessoriesByAssignment] = await Promise.all([
    getAssignmentsPhotos(assignmentIds),
    getAssignmentsAccessories(assignmentIds),
  ])
  const assignmentsWithEvidence = assignments.map((assignment) => ({
    ...assignment,
    photos: photosByAssignment.get(assignment.id) ?? [],
    accessories: accessoriesByAssignment.get(assignment.id) ?? [],
  }))

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
        maintenance={<AssetMaintenance assetId={asset.id} rows={maintenances} canManage={canManageMaintenance} suppliers={suppliersList} />}
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
