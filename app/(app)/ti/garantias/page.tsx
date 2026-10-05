import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, suppliers, worksites } from "@/db/schema"
import { eq, asc, and } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { listAssetsByWarranty, listSupplierLinks } from "@/lib/services/ti/supplier-links"
import { WarrantyTable } from "./warranty-table"
import { SupplierLinksPanel } from "./supplier-links-panel"
import { WarrantyFilters } from "./warranty-filters"
import { countWarrantyBands, matchesWarrantyView, parseWarrantyView } from "./warranty-windows"

export const metadata: Metadata = { title: "Garantías y proveedores" }

export default async function GarantiasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const sp = await searchParams
  // `?ventana=` conserva sus valores históricos (expiring_30, expired…): el
  // resumen del módulo enlaza con ellos. Ver `warranty-windows.ts`.
  const view = parseWarrantyView(sp.ventana)
  const faena = typeof sp.faena === "string" ? sp.faena : ""
  // Con `faena` el alcance sigue acotado a las faenas del usuario: pedir una
  // ajena devuelve vacío, no datos.
  const scope = worksiteScopeSql(session, itAssets.worksiteId, faena || undefined)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const [allRows, supplierLinks, suppliersList, worksitesList] = await Promise.all([
    // Sin ventana: los conteos de las pastillas se calculan sobre todo el
    // universo (acotado por faena) y la banda se aplica después, con la misma
    // regla que el badge de cada fila.
    listAssetsByWarranty({ scope }),
    listSupplierLinks(),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
  ])

  const counts = countWarrantyBands(allRows.map((r) => r.warrantyEndDate))
  const warrantyRows = allRows.filter((r) => matchesWarrantyView(r.warrantyEndDate, view))

  return (
    <PageContainer>
      <PageHeader
        title="Garantías y proveedores"
        description="Vigencia de garantías por activo y proveedores identificados para TI."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Garantías y proveedores" }]} />}
      />

      <WarrantyFilters view={view} faena={faena} counts={counts} worksites={worksitesList} />

      <WarrantyTable rows={warrantyRows} />

      <div className="mt-6">
        <SupplierLinksPanel links={supplierLinks} canManage={canManage} suppliers={suppliersList} />
      </div>
    </PageContainer>
  )
}
