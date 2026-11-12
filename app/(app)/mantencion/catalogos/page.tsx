import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { CatalogsWorkbench, type CatalogCounts } from "@/components/mantencion/jefatura/catalogos/catalogs-workbench"
import { requirePermission } from "@/lib/auth/can"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { catalogFromSlug } from "@/lib/mantencion/catalog-labels"
import { listCatalogAdminRows } from "@/lib/services/mantencion/catalog-admin"
import { listMantCatalogs } from "@/lib/services/mantencion/catalogs"

export const metadata: Metadata = { title: "Catálogos de mantención" }
export const dynamic = "force-dynamic"

export default async function CatalogsPage({ searchParams }: { searchParams: Promise<{ catalogo?: string | string[] }> }) {
  let session
  try {
    session = await requirePermission("mant:equipment:manage", "/mantencion/catalogos")
  } catch {
    redirect("/forbidden")
  }
  // Son comunes a todas las faenas: sólo quien ve todas los edita (las acciones lo vuelven a exigir).
  const canEdit = equipmentScope(viewerFromSession(session)) === "all"
  const raw = (await searchParams).catalogo
  const catalog = catalogFromSlug(Array.isArray(raw) ? raw[0] : raw)

  const [rows, all] = await Promise.all([listCatalogAdminRows(catalog), listMantCatalogs({ includeInactive: true })])
  const counts: CatalogCounts = {
    brands: all.brands.length, workshops: all.workshops.length, drivers: all.drivers.length, workTypes: all.workTypes.length, oils: all.oils.length,
  }

  return (
    <PageContainer>
      <CatalogsWorkbench catalog={catalog} rows={rows} counts={counts} canEdit={canEdit} />
    </PageContainer>
  )
}
