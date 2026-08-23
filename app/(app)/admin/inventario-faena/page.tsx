import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listWorksiteInventory, listWorksitesForInventory } from "@/lib/services/worksite-inventory"
import { InventoryList, type InventoryRow } from "./inventory-list"

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
  try { session = await requirePermission("admin:worksite_inventory") }
  catch { redirect("/forbidden") }

  const access = { userId: session.user.id, permissions: session.user.permissions }
  const [rows, worksites] = await Promise.all([
    listWorksiteInventory(access),
    listWorksitesForInventory(access),
  ])

  const inventory: InventoryRow[] = rows.map((row) => ({
    id: row.resource.id,
    worksiteId: row.resource.worksiteId,
    worksiteName: row.worksiteName,
    name: row.resource.name,
    kind: row.resource.kind,
    location: row.resource.location,
    serialNumber: row.resource.serialNumber,
    nextInspectionAt: row.resource.nextInspectionAt,
    expiresAt: row.resource.expiresAt,
    status: row.resource.status,
    planName: row.planName,
    inspectionCount: row.inspectionCount,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Inventario de faena"
        description="Extintores, kits de derrame y demás recursos instalados en terreno. Prevención los declara en el plan de emergencias y los inspecciona uno por uno; acá se carga y se mantiene el padrón."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Inventario de faena" },
        ]} />}
      />
      <InventoryList rows={inventory} worksites={worksites} canManage />
    </PageContainer>
  )
}
