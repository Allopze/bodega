import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getProductForEdit } from "../actions"
import { ProductRouteSheet } from "../product-route-sheet"

export const metadata: Metadata = { title: "Editar producto" }

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission("admin:products") }
  catch { redirect("/dashboard") }

  const { id } = await params
  const [product, allCategories, allSuppliers] = await Promise.all([
    getProductForEdit(id),
    db.query.productCategories.findMany({
      orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)],
    }),
    db.query.suppliers.findMany({
      where: eq(suppliers.isActive, true),
      orderBy: (s, { asc }) => [asc(s.name)],
    }),
  ])

  if (!product) notFound()

  return (
    <PageContainer width="form">
      <PageHeader
        title={product.name}
        description={`Editar SKU ${product.sku}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Productos", href: "/admin/productos" },
            { label: product.sku },
          ]} />
        }
      />
      <ProductRouteSheet
        categories={allCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
        allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
        editProduct={product}
      />
    </PageContainer>
  )
}
