import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, sql } from "drizzle-orm"
import { db } from "@/db"
import { products, productAttributeTemplates, productUnits } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CatalogActions } from "./catalog-actions"
import { CatalogList } from "./catalog-list"

export const metadata: Metadata = { title: "Catálogos de productos" }

export default async function ProductCatalogsPage() {
  try {
    await requirePermission("admin:product_catalogs")
  } catch {
    redirect("/forbidden")
  }

  const [units, templates, categories, distinctRows] = await Promise.all([
    db.select().from(productUnits).orderBy(asc(productUnits.sortOrder), asc(productUnits.code)),
    db.select().from(productAttributeTemplates).orderBy(asc(productAttributeTemplates.sortOrder), asc(productAttributeTemplates.name)),
    db.query.productCategories.findMany({
      orderBy: (category, { asc }) => [asc(category.sortOrder), asc(category.name)],
    }),
    db
      .select({ value: sql<string>`DISTINCT ${products.unitOfMeasure}` })
      .from(products)
      .orderBy(sql`${products.unitOfMeasure} ASC`),
  ])

  const registeredUnitCodes = new Set(units.map((unit) => unit.code))
  const legacyUnits = distinctRows
    .map((r) => r.value)
    .filter((value): value is string => typeof value === "string" && value.length > 0 && !registeredUnitCodes.has(value))
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))

  return (
    <PageContainer>
      <PageHeader
        title="Catálogos de productos"
        description="Unidades de medida y plantillas de atributos reutilizables para normalizar el catálogo."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de productos" },
        ]}
        actions={<CatalogActions categories={categories.map((category) => ({ id: category.id, name: category.name }))} />}
      />
      <CatalogList
        units={units.map((u) => ({
          id: u.id, code: u.code, label: u.label, description: u.description ?? "",
          sortOrder: u.sortOrder, isActive: u.isActive,
        }))}
        templates={templates.map((t) => ({
          id: t.id,
          categoryId: t.categoryId ?? "",
          categoryName: categoryNames.get(t.categoryId ?? "") ?? "",
          name: t.name,
          type: t.type,
          options: t.options ?? "",
          isRequired: t.isRequired,
          sortOrder: t.sortOrder,
          isActive: t.isActive,
        }))}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        legacyUnits={legacyUnits}
      />
    </PageContainer>
  )
}
