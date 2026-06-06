import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { products, suppliers } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ProductForm } from "../product-form"

export const metadata: Metadata = { title: "Editar producto" }

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission("admin:products") }
  catch { redirect("/dashboard") }

  const { id } = await params

  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
      productSuppliers: {
        with: { supplier: true },
        orderBy: (ps, { asc }) => [asc(ps.isPreferred)],
      },
    },
  })

  if (!product) notFound()

  const categories   = await db.query.productCategories.findMany({ orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)] })
  const allSuppliers = await db.query.suppliers.findMany({
    where: eq(suppliers.isActive, true),
    orderBy: (s, { asc }) => [asc(s.name)],
  })

  return (
    <>
      <PageHeader
        title={product.name}
        description={`SKU: ${product.sku}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
            { label: "Productos", href: "/admin/productos" },
            { label: product.sku },
          ]} />
        }
      />
      <div className="max-w-3xl">
        <ProductForm
          categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
          allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
          editProduct={{
            id:                 product.id,
            sku:                product.sku,
            name:               product.name,
            description:        product.description,
            categoryId:         product.categoryId,
            unitOfMeasure:      product.unitOfMeasure,
            isEpp:              product.isEpp,
            requiresPrevencion: product.requiresPrevencion,
            referencePrice:     product.referencePrice,
            notes:              product.notes,
            isActive:           product.isActive,
            attributes: product.productAttributes.map((a) => ({
              id:         a.id,
              name:       a.name,
              type:       a.type as "text" | "select" | "number",
              isRequired: a.isRequired,
              options:    a.options ?? "",
              sortOrder:  a.sortOrder,
            })),
            suppliers: product.productSuppliers.map((ps) => ({
              id:           ps.id,
              supplierId:   ps.supplierId,
              supplierName: ps.supplier?.name ?? ps.supplierId,
              unitPrice:    ps.unitPrice != null ? String(ps.unitPrice) : "",
              isPreferred:  ps.isPreferred,
              notes:        ps.notes ?? "",
            })),
          }}
        />
      </div>
    </>
  )
}
