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
  catch { redirect("/forbidden") }

  const [allProducts, allCategories, allSuppliers, recentBatches, units, templates] = await Promise.all([
    db.query.products.findMany({
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
    db.query.productUnits.findMany({
      where: (unit, { eq }) => eq(unit.isActive, true),
      orderBy: (unit, { asc }) => [asc(unit.sortOrder), asc(unit.code)],
    }),
    db.query.productAttributeTemplates.findMany({
      where: (template, { eq }) => eq(template.isActive, true),
      with: { category: true },
      orderBy: (template, { asc }) => [asc(template.sortOrder), asc(template.name)],
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
        units={units.map((unit) => ({ code: unit.code, label: unit.label, isActive: unit.isActive }))}
        templates={templates.map((template) => ({
          id: template.id,
          categoryId: template.categoryId ?? "",
          categoryName: template.category?.name,
          name: template.name,
          type: template.type as "text" | "select" | "number",
          isRequired: template.isRequired,
          options: template.options ?? "",
          sortOrder: template.sortOrder,
        }))}
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
