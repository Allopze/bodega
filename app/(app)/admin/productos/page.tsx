import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CatalogTabs } from "./catalog-tabs"
import { categoriesForCatalogProducts } from "@/lib/products/spare-parts-category"
import { ProductList } from "./product-list"
import { ProductActions } from "./product-actions"
import { getSizeFamilyOptions } from "@/lib/services/sizes"

export const metadata: Metadata = { title: "Catálogo de productos" }

export default async function ProductosPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/forbidden") }

  const [allProducts, allCategories, allSuppliers, recentBatches, sizeFamilies] = await Promise.all([
    // Los repuestos de catálogo se gestionan en Mantención → Catálogo de
    // repuestos: editarlos aquí podía cambiar marcas (EPP/servicio) que el CHECK
    // de `products` prohíbe combinar con `is_spare_part`.
    db.query.products.findMany({
      where: (p, { eq }) => eq(p.isSparePart, false),
      with: {
        category: true,
        productAttributes: {
          orderBy: (attribute, { asc }) => [asc(attribute.sortOrder)],
        },
        productSuppliers: true,
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
    // Las tallas del asistente salen de `size_catalog`, no del bundle.
    getSizeFamilyOptions(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de productos"
        description="Cada artículo que se compra o se entrega, con su talla y color. Los repuestos se gestionan en Catálogo de repuestos."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Productos" },
          ]} />
        }
        actions={
          <ProductActions
            categories={categoriesForCatalogProducts(allCategories).map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder }))}
            allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
            sizeFamilies={sizeFamilies}
          />
        }
      />
      <CatalogTabs current="productos" />
      <ProductList
        products={allProducts.map((p) => ({
          id: p.id, sku: p.sku, name: p.name,
          familyId: p.familyId,
          categoryId: p.categoryId, categoryName: p.category?.name ?? "—",
          isEpp: p.isEpp, requiresPrevencion: p.requiresPrevencion,
          referencePrice: p.referencePrice,
          hasPreferredSupplier: p.productSuppliers.some((s) => s.isPreferred),
          isActive: p.isActive, createdAt: p.createdAt,
          attributes: p.productAttributes.map((attribute) => ({
            name: attribute.name,
            sortOrder: attribute.sortOrder,
            options: attribute.options,
            isRequired: attribute.isRequired,
          })),
        }))}
        categories={allCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion, sortOrder: c.sortOrder }))}
        allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
        sizeFamilies={sizeFamilies}
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
