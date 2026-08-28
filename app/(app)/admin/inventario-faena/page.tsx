import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, canAny, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listEmergencyResourceCoverage, listWorksiteInventory, listWorksitesForInventory } from "@/lib/services/worksite-inventory"
import { todayInChile } from "@/lib/utils"
import { InventoryList, InventoryPageActions, type CoveragePointRow, type InventoryRow } from "./inventory-list"

export const metadata: Metadata = { title: "Inventario de faena" }

/**
 * Padrón de los recursos físicos instalados en cada faena.
 *
 * Vive en Administración y no en Prevención porque es dato maestro: el inventario
 * existe por la operación, y Prevención sólo lo consume —para declararlo en el
 * plan de emergencias y para inspeccionar cada equipo—. Antes la única alta
 * estaba dentro de un plan de emergencias **en borrador**, así que un extintor
 * que llegaba a la faena no podía registrarse si el plan ya estaba aprobado.
 */
export default async function InventarioFaenaPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!canAny(session, "admin:worksite_inventory", "admin:worksite_inventory_service")) redirect("/forbidden")

  const access = {
    userId: session.user.id,
    permissions: session.user.permissions,
    scope: serviceWorksiteScope(session),
  }
  const [rows, worksites, coverageRows] = await Promise.all([
    listWorksiteInventory(access),
    listWorksitesForInventory(access),
    listEmergencyResourceCoverage(access),
  ])

  const inventory: InventoryRow[] = rows.map((row) => ({
    id: row.resource.id,
    worksiteId: row.resource.worksiteId,
    worksiteName: row.worksiteName,
    assetCode: row.resource.assetCode,
    typeId: row.resource.typeId,
    canonicalType: row.technicalType?.canonicalName ?? null,
    agent: row.technicalType?.agent ?? null,
    capacity: row.technicalType?.capacity ?? null,
    capacityUnit: row.technicalType?.capacityUnit ?? null,
    name: row.resource.name,
    kind: row.resource.kind,
    location: row.resource.location,
    serialNumber: row.resource.serialNumber,
    lastMaintenanceAt: row.resource.lastMaintenanceAt,
    nextInspectionAt: row.resource.nextInspectionAt,
    expiresAt: row.resource.expiresAt,
    status: row.resource.status,
    planName: row.planName,
    inspectionCount: row.inspectionCount,
  }))
  const points: CoveragePointRow[] = coverageRows.map((row) => ({
    id: row.point.id,
    worksiteId: row.point.worksiteId,
    code: row.point.code,
    label: row.point.label,
    pointKind: row.point.pointKind,
    requiredTypeId: row.point.requiredTypeId,
    vehiclePlate: row.vehiclePlate,
    vehicleBrand: row.vehicleBrand,
    vehicleCategory: row.vehicleCategory,
    assignedResourceId: row.assignedResourceId,
    assignedAssetCode: row.assetCode,
    assignedResourceName: row.resourceName,
    state: row.coverage.state,
    reasons: row.coverage.reason ? [row.coverage.reason] : [],
  }))
  const canManage = can(session, "admin:worksite_inventory")
  const canService = can(session, "admin:worksite_inventory_service")

  return (
    <PageContainer>
      <PageHeader
        title="Inventario de faena"
        description="Extintores, kits de derrame y demás recursos instalados en terreno. Prevención los declara en el plan de emergencias y los inspecciona uno por uno; acá se carga y se mantiene el padrón."
        actions={<InventoryPageActions worksites={worksites} canManage={canManage} />}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Inventario de faena" },
        ]} />}
      />
      <InventoryList
        rows={inventory}
        points={points}
        worksites={worksites}
        canManage={canManage}
        canService={canService}
        today={todayInChile()}
      />
    </PageContainer>
  )
}
