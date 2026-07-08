import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, sql } from "drizzle-orm"
import { db } from "@/db"
import { products, productAttributeTemplates, productUnits } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CatalogList } from "./catalog-list"

export const metadata: Metadata = { title: "Catálogos de productos" }

export default async function ProductCatalogsPage() {
  try {
    await requirePermission("admin:product_catalogs")
  } catch {
    redirect("/forbidden")
  }

  const [units, templates, distinctRows] = await Promise.all([
    db.select().from(productUnits).orderBy(asc(productUnits.sortOrder), asc(productUnits.code)),
    db.select().from(productAttributeTemplates).orderBy(asc(productAttributeTemplates.sortOrder), asc(productAttributeTemplates.name)),
    db
      .select({ value: sql<string>`DISTINCT ${products.unitOfMeasure}` })
      .from(products)
      .orderBy(sql`${products.unitOfMeasure} ASC`),
  ])

  const legacyUnits = distinctRows.map((r) => r.value).filter((v) => typeof v === "string" && v.length > 0) as string[]

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
      />
      <CatalogList
        units={units.map((u) => ({
          id: u.id, code: u.code, label: u.label, description: u.description ?? "",
          sortOrder: u.sortOrder, isActive: u.isActive,
        }))}
        templates={templates.map((t) => ({
          id: t.id,
          categoryId: t.categoryId ?? "",
          name: t.name,
          type: t.type,
          options: t.options ?? "",
          isRequired: t.isRequired,
          sortOrder: t.sortOrder,
          isActive: t.isActive,
        }))}
        legacyUnits={legacyUnits}
      />
    </PageContainer>
  )
}
