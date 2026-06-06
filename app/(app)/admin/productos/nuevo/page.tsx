import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { suppliers } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ProductForm } from "../product-form"

export const metadata: Metadata = { title: "Nuevo producto" }

export default async function NuevoProductoPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/dashboard") }

  const categories    = await db.query.productCategories.findMany({ orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)] })
  const allSuppliers  = await db.query.suppliers.findMany({
    where: eq(suppliers.isActive, true),
    orderBy: (s, { asc }) => [asc(s.name)],
  })

  return (
    <>
      <PageHeader
        title="Nuevo producto"
        description="Completa los datos del nuevo producto del catálogo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
            { label: "Productos", href: "/admin/productos" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <div className="max-w-3xl">
        <ProductForm
          categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
          allSuppliers={allSuppliers.map((s) => ({ id: s.id, name: s.name }))}
        />
      </div>
    </>
  )
}
