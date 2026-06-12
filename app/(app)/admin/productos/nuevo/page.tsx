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
  catch { redirect("/dashboard") }

  const [allCategories, allSuppliers] = await Promise.all([
    db.query.productCategories.findMany({
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    }),
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: (s, { asc }) => [asc(s.name)],
    }),
  ])

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nuevo producto"
        description="Registra un producto del catálogo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Productos", href: "/admin/productos" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <ProductRouteSheet
        categories={allCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
        allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
      />
    </PageContainer>
  )
}
