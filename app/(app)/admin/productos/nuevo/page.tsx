import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ProductRouteSheet } from "../product-route-sheet"

export const metadata: Metadata = { title: "Nuevo producto" }

export default async function NuevoProductoPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/forbidden") }

  const [allCategories, allSuppliers, units, templates] = await Promise.all([
    db.query.productCategories.findMany({
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    }),
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: (s, { asc }) => [asc(s.name)],
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
        categories={allCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, isEpp: c.isEpp, requiresPrevencion: c.requiresPrevencion }))}
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
      />
    </PageContainer>
  )
}
