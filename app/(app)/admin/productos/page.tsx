import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ProductList } from "./product-list"

export const metadata: Metadata = { title: "Catálogo de productos" }

export default async function ProductosPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/dashboard") }

  const allProducts = await db.query.products.findMany({
    with: { category: true },
    orderBy: (p, { asc }) => [asc(p.name)],
  })

  const allCategories = await db.query.productCategories.findMany({
    orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
  })

  return (
    <>
      <PageHeader
        title="Catálogo de productos"
        description="Productos, categorías, atributos y EPP."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
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
      />
    </>
  )
}
