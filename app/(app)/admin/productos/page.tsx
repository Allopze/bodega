import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ProductList } from "./product-list"

export const metadata: Metadata = { title: "Catálogo de productos" }

export default async function ProductosPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/dashboard") }

  const [allProducts, allCategories, allSuppliers] = await Promise.all([
    db.query.products.findMany({
      with: { category: true },
      orderBy: (p, { asc }) => [asc(p.name)],
    }),
    db.query.productCategories.findMany({
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    }),
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: (s, { asc }) => [asc(s.name)],
    }),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de productos"
        description="Productos, categorías, atributos y EPP."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Productos" },
          ]} />
        }
      />
      <ProductList
        products={allProducts.map((p) => ({
          id: p.id, sku: p.sku, name: p.name,
          categoryId: p.categoryId, categoryName: p.category?.name ?? "—",
          isEpp: p.isEpp, requiresPrevencion: p.requiresPrevencion,
          referencePrice: p.referencePrice,
          isActive: p.isActive, createdAt: p.createdAt,
        }))}
        categories={allCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder }))}
        allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
      />
    </PageContainer>
  )
}
