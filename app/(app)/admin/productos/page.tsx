import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { eppImportBatches } from "@/db/schema"
import { suppliers } from "@/db/schema"
import { desc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ProductList } from "./product-list"

export const metadata: Metadata = { title: "Catálogo de productos" }

export default async function ProductosPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/forbidden") }

  const [allProducts, allCategories, allSuppliers, recentBatches] = await Promise.all([
    db.query.products.findMany({
      with: {
        category: true,
        productAttributes: {
          orderBy: (attribute, { asc }) => [asc(attribute.sortOrder)],
        },
      },
      orderBy: (p, { asc }) => [asc(p.name)],
    }),
    db.query.productCategories.findMany({
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    }),
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: (s, { asc }) => [asc(s.name)],
    }),
    db.query.eppImportBatches.findMany({
      orderBy: (batch, { desc }) => [desc(batch.createdAt)],
      limit: 10,
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
          attributes: p.productAttributes.map((attribute) => ({
            name: attribute.name,
            sortOrder: attribute.sortOrder,
            options: attribute.options,
          })),
        }))}
        categories={allCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder }))}
        allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
        recentBatches={recentBatches.map((batch) => {
          let rowCount: number | null = null
          try {
            const meta = JSON.parse(batch.sourceFileJson) as { rowCount?: number }
            rowCount = meta.rowCount ?? null
          } catch { /* ignore */ }
          return {
            id: batch.id,
            fileName: batch.fileName,
            status: batch.status,
            createdAt: batch.createdAt,
            rowCount,
          }
        })}
      />
    </PageContainer>
  )
}
