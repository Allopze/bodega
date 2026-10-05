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
import { Callout } from "@/components/ui/callout"
import { Package, Tag } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { listAssets, countRetiredAssets, type AssetListFilters } from "@/lib/services/ti/assets"
import { isRetiredStatus } from "@/lib/services/ti/constants"
import { listAssetTypes } from "@/lib/services/ti/asset-types"
import { AssetTable } from "./asset-table"
import { AssetFilters } from "./asset-filters"
import { NewAssetCta } from "./asset-form-sheet"

export const metadata: Metadata = { title: "Inventario" }

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const canAdminTypes = can(session, "admin:it_asset_types")
  const sp = await searchParams
  const status = typeof sp.estado === "string" ? sp.estado : undefined

  const scope = worksiteScopeSql(session, itAssets.worksiteId)
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const filters: AssetListFilters = {
    typeId: typeof sp.tipo === "string" ? sp.tipo : undefined,
    status,
    includeRetired: isRetiredStatus(status ?? ""),
    workerId: typeof sp.trabajador === "string" ? sp.trabajador : undefined,
    worksiteId: typeof sp.faena === "string" ? sp.faena : undefined,
    supplierId: typeof sp.proveedor === "string" ? sp.proveedor : undefined,
    warrantyWindow: typeof sp.garantia === "string"
      ? (sp.garantia as AssetListFilters["warrantyWindow"])
      : undefined,
    maxAgeYears: typeof sp.antiguedad === "string" && /^\d+$/.test(sp.antiguedad)
      ? Number(sp.antiguedad)
      : undefined,
    // `antiguedad_min` responde "qué conviene reemplazar": equipos con N años
    // o más. Es el destino del gráfico de antigüedad del tablero.
    minAgeYears: typeof sp.antiguedad_min === "string" && /^\d+$/.test(sp.antiguedad_min)
      ? Number(sp.antiguedad_min)
      : undefined,
    scope,
  }

  const [assets, retiredHidden, types, activeWorkers, activeWorksites, activeSuppliers] = await Promise.all([
    listAssets(filters),
    // Solo se pregunta cuando la lista las oculta: con un estado terminal elegido ya se ven.
    filters.includeRetired ? Promise.resolve(0) : countRetiredAssets(scope),
    listAssetTypes({ includeInactive: true }),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
  ])

  const FILTER_KEYS = ["tipo", "estado", "trabajador", "faena", "proveedor", "garantia", "antiguedad", "antiguedad_min"] as const
  const hasFilters = FILTER_KEYS.some((key) => typeof sp[key] === "string" && sp[key])
  const isEmpty = assets.length === 0

  return (
    <PageContainer>
      <PageHeader
        title="Inventario"
        description="Activos tecnológicos de CHOME: qué hay, dónde está y quién lo tiene."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Inventario" }]} />}
        actions={(canManage || canAdminTypes) ? (
          <div className="flex flex-wrap items-center gap-2">
            {canAdminTypes && (
              <Button asChild variant="ghost">
                <Link href="/admin/tipos-activo"><Tag size={14} className="mr-1.5" aria-hidden /> Tipos de activo</Link>
              </Button>
            )}
            {canManage && (
              <NewAssetCta assetTypes={types} suppliers={activeSuppliers} worksites={activeWorksites} canManageTypes={canAdminTypes} />
            )}
          </div>
        ) : undefined}
      />

      {/* Sin activos y sin filtros no hay nada que filtrar: se omite la barra. */}
      {(hasFilters || !isEmpty) && (
        <AssetFilters
          types={types}
          workers={activeWorkers}
          worksites={activeWorksites}
          suppliers={activeSuppliers}
          current={sp}
        />
      )}

      {isEmpty ? (
        // Un solo estado vacío (antes se apilaban este y el de la tabla).
        hasFilters ? (
          <EmptyState
            compact
            icon={<Package size={22} aria-hidden />}
            title="No hay activos con estos filtros"
            description="Ningún activo cumple todos los filtros aplicados. Quita alguno para ver más resultados."
            action={<Button asChild variant="secondary" size="sm"><Link href="/ti/activos" scroll={false}>Limpiar filtros</Link></Button>}
          />
        ) : (
          <EmptyState
            icon={<Package size={22} aria-hidden />}
            title="Aún no hay activos"
            description={canManage
              ? "Registra el primer equipo para llevar su custodia, mantenciones y garantía en un solo lugar."
              : "Cuando TI registre equipos aparecerán aquí. Si esperabas verlos, consulta con quien administra el inventario."}
            action={canManage ? <NewAssetCta assetTypes={types} suppliers={activeSuppliers} worksites={activeWorksites} canManageTypes={canAdminTypes} /> : undefined}
          />
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-[var(--color-text-muted)]" aria-live="polite">
            <span className="font-semibold text-[var(--color-text)]">{assets.length}</span>{" "}
            {assets.length === 1 ? "activo" : "activos"}{hasFilters ? " con los filtros aplicados" : ""}
          </p>
          <AssetTable rows={assets as AssetRow[]} />
        </>
      )}

      {retiredHidden > 0 && (
        <Callout tone="info" className="mt-4">
          {retiredHidden === 1 ? "1 activo dado de baja, perdido o robado no aparece" : `${retiredHidden} activos dados de baja, perdidos o robados no aparecen`} en esta lista.{" "}
          <Link href="/ti/activos?estado=dado_de_baja" className="font-semibold underline">Ver dados de baja</Link>
          {" "}o elige «Perdido» o «Robado» en el filtro de estado.
        </Callout>
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
