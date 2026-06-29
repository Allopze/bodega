import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites, products, productAttributes, suppliers, productSuppliers } from "@/db/schema"
import { eq, asc, desc } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/can"
import type { Session } from "next-auth"
import { RepuestoForm } from "../../repuestos/request-form"
import { ServiceForm } from "../../servicios/request-form"
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

export default async function NuevaSolicitudPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const tipo = typeof sp.tipo === "string" ? sp.tipo : undefined

  // Repuestos/servicios use their specialized forms (free-text items + equipment
  // data + PDF cotizaciones), rendered inline under /solicitudes.
  if (tipo === "repuestos" || tipo === "servicios") {
    return <NuevaQuotationRequest session={session} tipo={tipo} />
  }

  const requestTypeOptions = visibleRequestTypeOptions(session.user.permissions, "create")
  if (requestTypeOptions.length === 0) redirect("/forbidden")

  const [allWorksites, allProducts, allAttrs, productSupplierRows, allSuppliers, maxFileSizeMb] = await Promise.all([
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
      {(can(session, "repuestos:create") || can(session, "servicios:create")) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">¿Otro tipo de solicitud?</span>
          {can(session, "repuestos:create") && (
            <Button asChild variant="secondary" size="sm">
              <Link href="/solicitudes/nueva?tipo=repuestos">Repuestos</Link>
            </Button>
          )}
          {can(session, "servicios:create") && (
            <Button asChild variant="secondary" size="sm">
              <Link href="/solicitudes/nueva?tipo=servicios">Servicios</Link>
            </Button>
          )}
        </div>
      )}
      <RequestForm
        worksites={worksiteOptions}
        products={productOptions}
        suppliers={supplierOptions}
        maxFileSizeMb={maxFileSizeMb}
        userRoles={session.user.roles}
        userPermissions={session.user.permissions}
      />
    </PageContainer>
  )
}

/* ── Quotation-based request (repuestos / servicios) ──────────────────────── */
async function NuevaQuotationRequest({
  session,
  tipo,
}: {
  session: Session
  tipo: "repuestos" | "servicios"
}) {
  const createPerm = tipo === "repuestos" ? "repuestos:create" : "servicios:create"
  if (!can(session, createPerm)) redirect("/forbidden")

  const allWorksites = await db
    .select()
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))

  const scopedWorksites = allWorksites.filter((w) => canAccessWorksite(session, w.id))
  const worksiteOptions = scopedWorksites.map((w) => ({ id: w.id, name: w.name }))

  const label = tipo === "repuestos" ? "repuestos" : "servicios"
  const title = `Nueva solicitud de ${label}`
  const description = tipo === "repuestos"
    ? "Completa los datos, agrega los repuestos y adjunta las cotizaciones."
    : "Completa los datos, agrega los servicios y adjunta las cotizaciones."

  if (worksiteOptions.length === 0) {
    return (
      <PageContainer width="workbench">
        <PageHeader
          title={title}
          description={description}
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
            description="No tienes faenas activas asignadas a tu cuenta. Contacta a un administrador para que te asigne una faena antes de poder crear una solicitud."
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
        title={title}
        description={description}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",   href: "/dashboard"   },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: "Nueva"                             },
          ]} />
        }
      />
      {tipo === "repuestos"
        ? <RepuestoForm worksites={worksiteOptions} />
        : <ServiceForm worksites={worksiteOptions} />}
    </PageContainer>
  )
}
