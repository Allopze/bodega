import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, itTickets, users, suppliers, workers, worksites } from "@/db/schema"
import { eq, and, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getAssetById, listAssetRetirements } from "@/lib/services/ti/assets"
import { getAssetHistory } from "@/lib/services/ti/history"
import { listAssignments, getAssignmentsPhotos, getAssignmentsAccessories } from "@/lib/services/ti/assignments"
import { listMaintenances } from "@/lib/services/ti/maintenance"
import { isRetiredStatus } from "@/lib/services/ti/constants"
import { listAssetTypes } from "@/lib/services/ti/asset-types"
import { listTiAttachments } from "@/lib/services/ti/attachments"
import type { ItAssetFormData } from "@/lib/validation/ti"
import { AssetDetailTabs } from "./asset-detail-tabs"
import { AssetSummary } from "./asset-summary"
import { AssetHeader } from "./asset-header"
import { AssetNextAction } from "./asset-next-action"
import { AssetHistory } from "./asset-history"
import { AssetAssignments } from "./asset-assignments"
import { AssetMaintenance } from "./asset-maintenance"
import { AssetTickets } from "./asset-tickets"
import { AssetDocuments } from "./asset-documents"
import { EditAssetCta } from "../asset-form-sheet"

export const metadata: Metadata = { title: "Ficha de activo" }

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

  const canManage = can(session, "ti:manage_assets")
  // Registrar, editar y anular mantenciones tiene su propio permiso: sin esto,
  // un rol con `ti:manage_assets` pero sin `ti:manage_maintenance` veía los
  // botones y recibía "Sin permisos" recién al enviar el formulario.
  const canManageMaintenance = can(session, "ti:manage_maintenance")
  // Los catálogos de edición (tipos, proveedores, faenas, trabajadores, usuarios)
  // solo los usan los formularios: quien únicamente consulta no los carga.
  const needsCatalogs = canManage || canManageMaintenance

  // Todo en paralelo: el alcance de faena se resuelve dentro de `getAssetById`
  // y, si el activo no es visible, `notFound()` descarta el resto sin mostrarlo.
  const [asset, history, assignments, maintenances, tickets, retirements, documents, assetTypes, suppliersList, worksitesList, workersList, retirementUsers] = await Promise.all([
    getAssetById(id, scope),
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
    listAssetRetirements(id),
    listTiAttachments("it_asset", id),
    canManage ? listAssetTypes({ includeInactive: true }) : Promise.resolve([]),
    needsCatalogs
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.isActive, true))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(and(eq(worksites.isActive, true), worksiteListScope))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName }).from(workers).where(and(eq(workers.isActive, true), workerScope))
      : Promise.resolve([]),
    canManage
      ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name))
      : Promise.resolve([]),
  ])
  if (!asset) notFound()

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
  const activeRetirement = retirements.find((r) => !r.reversedAt) ?? null
  const workerOptions = workersList.map((w) => ({ id: w.id, name: w.firstName, lastName: w.lastName }))
  const canDeliver = canManage && (asset.status === "disponible" || asset.status === "en_bodega")

  return (
    <PageContainer>
      <PageHeader
        title={asset.code}
        breadcrumb={<Breadcrumbs items={[
          { label: "TI", href: "/ti" },
          { label: "Inventario", href: "/ti/activos" },
          { label: asset.code },
        ]} />}
        // Una baja formal no se edita desde la ficha: el banner explica cómo revertirla.
        actions={canManage && asset.status !== "dado_de_baja" ? (
          <EditAssetCta
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

      <AssetHeader asset={asset} retirement={activeRetirement}>
        <AssetNextAction
          asset={asset}
          custody={activeAssignment}
          canManage={canManage}
          canManageMaintenance={canManageMaintenance}
          hasRetirement={Boolean(activeRetirement)}
          workers={workerOptions}
          worksites={worksitesList}
          suppliers={suppliersList}
          retirementUsers={retirementUsers}
        />
      </AssetHeader>

      <AssetDetailTabs
        assetId={asset.id}
        summary={<AssetSummary asset={asset} activeAssignment={activeAssignment} />}
        assignments={<AssetAssignments assetId={asset.id} rows={assignmentsWithEvidence} canDeliver={canDeliver} workers={workerOptions} worksites={worksitesList} />}
        maintenance={<AssetMaintenance assetId={asset.id} rows={maintenances} canManage={canManageMaintenance && !isRetiredStatus(asset.status)} suppliers={suppliersList} />}
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
