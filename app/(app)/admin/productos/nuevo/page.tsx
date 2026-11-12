import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { categoriesForCatalogProducts } from "@/lib/products/spare-parts-category"
import { ProductRouteSheet } from "../product-route-sheet"
import { getSizeFamilyOptions } from "@/lib/services/sizes"

export const metadata: Metadata = { title: "Nuevo producto" }

export default async function NuevoProductoPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/forbidden") }

  const [allCategories, allSuppliers, sizeFamilies] = await Promise.all([
    db.query.productCategories.findMany({
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    }),
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: (s, { asc }) => [asc(s.name)],
    }),
    // Las tallas del asistente salen de `size_catalog`, no del bundle.
    getSizeFamilyOptions(),
  ])

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Nuevo producto"
        description="Registra un producto del catálogo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Productos", href: "/admin/productos" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <ProductRouteSheet
        categories={categoriesForCatalogProducts(allCategories).map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion }))}
        allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
        sizeFamilies={sizeFamilies}
      />
    </PageContainer>
  )
}
