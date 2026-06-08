import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites, costCenters, products, productAttributes } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { RequestForm } from "../request-form"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Warning } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Nueva solicitud de compra" }

export default async function NuevaSolicitudPage() {
  let session
  try { session = await requirePermission("requests:create") }
  catch { redirect("/dashboard") }

  const [allWorksites, allProducts, allAttrs] = await Promise.all([
    db.select().from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
    db.select().from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
    db.select().from(productAttributes)
      .orderBy(asc(productAttributes.sortOrder)),
  ])

  // Scope worksites to the user's assignments
  const scopedWorksites = allWorksites.filter(
    (w) => canAccessWorksite(session, w.id),
  )

  // Load cost centers for scoped worksites
  const wsIds = scopedWorksites.map((w) => w.id)
  const allCcs = wsIds.length > 0
    ? await db.select().from(costCenters)
        .where(eq(costCenters.isActive, true))
        .orderBy(asc(costCenters.name))
    : []

  const worksiteOptions = scopedWorksites.map((w) => ({
    id:          w.id,
    name:        w.name,
    costCenters: allCcs.filter((cc) => cc.worksiteId === w.id).map((cc) => ({
      id:   cc.id,
      name: cc.name,
    })),
  }))

  const productOptions = allProducts.map((p) => ({
    id:             p.id,
    sku:            p.sku,
    name:           p.name,
    unitOfMeasure:  p.unitOfMeasure,
    categoryName:   p.categoryId,
    referencePrice: p.referencePrice,
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

  if (worksiteOptions.length === 0) {
    return (
      <>
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
      </>
    )
  }

  return (
    <>
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
      <div className="max-w-3xl">
        <RequestForm
          worksites={worksiteOptions}
          products={productOptions}
        />
      </div>
    </>
  )
}
