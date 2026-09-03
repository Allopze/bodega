import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, workers, worksites, suppliers } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { listAssets, type AssetListFilters } from "@/lib/services/ti/assets"
import { listAssetTypes } from "@/lib/services/ti/asset-types"
import { AssetTable } from "./asset-table"
import { AssetFilters } from "./asset-filters"
import { AssetFormSheet } from "./asset-form-sheet"

export const metadata: Metadata = { title: "Inventario TI" }

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const sp = await searchParams
  const status = typeof sp.estado === "string" ? sp.estado : undefined

  const scope = worksiteScopeSql(session, itAssets.worksiteId)
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const filters: AssetListFilters = {
    typeId: typeof sp.tipo === "string" ? sp.tipo : undefined,
    status,
    includeRetired: ["dado_de_baja", "perdido", "robado"].includes(status ?? ""),
    workerId: typeof sp.trabajador === "string" ? sp.trabajador : undefined,
    worksiteId: typeof sp.faena === "string" ? sp.faena : undefined,
    supplierId: typeof sp.proveedor === "string" ? sp.proveedor : undefined,
    warrantyWindow: typeof sp.garantia === "string"
      ? (sp.garantia as AssetListFilters["warrantyWindow"])
      : undefined,
    maxAgeYears: typeof sp.antiguedad === "string" && /^\d+$/.test(sp.antiguedad)
      ? Number(sp.antiguedad)
      : undefined,
    scope,
  }

  const [assets, types, activeWorkers, activeWorksites, activeSuppliers] = await Promise.all([
    listAssets(filters),
    listAssetTypes({ includeInactive: true }),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Inventario TI"
        description="Activos tecnológicos de CHOME: qué hay, dónde está y quién lo tiene."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Inventario" }]} />}
        actions={canManage ? (
          <AssetFormSheet
            trigger={
              <Button>
                <Plus size={14} className="mr-1.5" /> Nuevo activo
              </Button>
            }
            assetTypes={types}
            suppliers={activeSuppliers}
            worksites={activeWorksites}
          />
        ) : undefined}
      />

      <AssetFilters
        types={types}
        workers={activeWorkers}
        worksites={activeWorksites}
        suppliers={activeSuppliers}
        current={sp}
      />

      <AssetTable rows={assets as AssetRow[]} canManage={canManage} />

      {assets.length === 0 && (
        <EmptyState
          className="mt-4"
          compact
          title="No hay activos con estos filtros"
          description={canManage ? "Limpia los filtros o registra un activo para comenzar." : "Prueba con otros filtros o términos de búsqueda."}
          action={canManage ? <Link href="/ti/activos"><Button variant="secondary" size="sm">Limpiar filtros</Button></Link> : undefined}
        />
      )}
    </PageContainer>
  )
}

export type AssetRow = {
  id: string
  code: string
  brand: string | null
  model: string | null
  serialNumber: string | null
  status: string
  workerId: string | null
  worksiteId: string | null
  location: string | null
  purchaseDate: string | null
  warrantyEndDate: string | null
  cost: number | null
  supplierId: string | null
  assetTypeId: string
  createdAt: string
  typeName: string
  workerName: string | null
  worksiteName: string | null
  maintenanceCount: number
  maintenanceCost: number
  ticketCount: number
}
