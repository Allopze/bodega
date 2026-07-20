import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites, products, productAttributes, suppliers, productSuppliers, workers } from "@/db/schema"
import { eq, asc, desc } from "drizzle-orm"
import { requireAuth } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { visibleRequestTypeOptions } from "@/lib/request-types"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RequestForm } from "../request-form"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Warning } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Nueva solicitud de compra" }

export default async function NuevaSolicitudPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

  const requestTypeOptions = visibleRequestTypeOptions(session.user.permissions, "create")
  if (requestTypeOptions.length === 0) redirect("/forbidden")

  const [allWorksites, allProducts, allAttrs, productSupplierRows, allSuppliers, allWorkers, maxFileSizeMb] = await Promise.all([
    db.select().from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
    db.select().from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
    db.select().from(productAttributes)
      .orderBy(asc(productAttributes.sortOrder)),
    db
      .select({
        productId:  productSuppliers.productId,
        supplierId: productSuppliers.supplierId,
      })
      .from(productSuppliers)
      .orderBy(desc(productSuppliers.isPreferred)),
    db.select().from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name)),
    db.select({
      id: workers.id, firstName: workers.firstName, lastName: workers.lastName,
      sizeTop: workers.sizeTop, sizeBottom: workers.sizeBottom, sizeShoe: workers.sizeShoe,
      sizeGloves: workers.sizeGloves, sizeHelmet: workers.sizeHelmet, worksiteId: workers.worksiteId,
    }).from(workers)
      .where(eq(workers.isActive, true))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    getPdfMaxSizeMb(),
  ])

  // Scope worksites to the user's assignments
  const scopedWorksites = allWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )

  const worksiteOptions = scopedWorksites.map((w) => ({
    id:          w.id,
    name:        w.name,
  }))

  const activeSupplierIds = new Set(allSuppliers.map((supplier) => supplier.id))
  const preferredSupplierByProduct = new Map<string, string>()
  for (const row of productSupplierRows) {
    if (activeSupplierIds.has(row.supplierId) && !preferredSupplierByProduct.has(row.productId)) {
      preferredSupplierByProduct.set(row.productId, row.supplierId)
    }
  }

  const productOptions = allProducts.map((p) => ({
    id:             p.id,
    sku:            p.sku,
    name:           p.name,
    isEpp:          p.isEpp,
    unitOfMeasure:  p.unitOfMeasure,
    categoryName:   p.categoryId,
    referencePrice: p.referencePrice,
    preferredSupplierId: preferredSupplierByProduct.get(p.id) ?? null,
    attributes:     allAttrs
      .filter((a) => a.productId === p.id)
      .map((a) => ({
        id:         a.id,
        name:       a.name,
        type:       a.type,
        isRequired: a.isRequired,
        options:    a.options,
      })),
  }))

  const supplierOptions = allSuppliers.map((s) => ({
    id:   s.id,
    name: s.name,
  }))

  const scopedWorksiteIds = new Set(scopedWorksites.map((w) => w.id))
  const workerOptions = allWorkers
    .filter((w) => scopedWorksiteIds.has(w.worksiteId))
    .map((w) => ({
      id:         w.id,
      firstName:  w.firstName,
      lastName:   w.lastName,
      sizeTop:    w.sizeTop,
      sizeBottom: w.sizeBottom,
      sizeShoe:   w.sizeShoe,
      sizeGloves: w.sizeGloves,
      sizeHelmet: w.sizeHelmet,
    }))

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer width="workbench">
        <PageHeader
          title="Nueva solicitud de compra"
          description="Completa los datos y agrega los ítems que necesitas."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Dashboard",   href: "/dashboard"   },
              { label: "Solicitudes", href: "/solicitudes" },
              { label: "Nueva"                             },
            ]} />
          }
        />
        <div className="max-w-md mx-auto mt-8 p-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius)]">
          <EmptyState
            icon={<Warning size={28} className="text-[var(--color-warning)]" />}
            title="Sin faenas asignadas"
            description="No tienes faenas activas asignadas a tu cuenta o no existen faenas en el sistema. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/solicitudes">Volver a solicitudes</Link>
              </Button>
            }
          />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Nueva solicitud de compra"
        description="Completa los datos y agrega los ítems que necesitas."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",   href: "/dashboard"   },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: "Nueva"                             },
          ]} />
        }
      />
      <RequestForm
        worksites={worksiteOptions}
        products={productOptions}
        suppliers={supplierOptions}
        workers={workerOptions}
        maxFileSizeMb={maxFileSizeMb}
        userRoles={session.user.roles}
        userPermissions={session.user.permissions}
      />
    </PageContainer>
  )
}
