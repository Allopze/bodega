import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EppFamilyList } from "./epp-family-list"
import type { EppFamilyRow } from "./epp-family-list"

export const metadata = { title: "Catálogo de EPP" }

export default async function EppsPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/forbidden") }

  const raw = await db.query.eppProductFamilies.findMany({
    with: {
      category: true,
      type: true,
      products: {
        with: {
          productAttributes: true,
        },
        orderBy: (p, { asc }) => [asc(p.name)],
      },
    },
    orderBy: (f, { asc }) => [asc(f.canonicalName)],
  })

  // `epp_product_families` ahora también agrupa variantes de productos que no
  // son EPP (es el mecanismo de agrupación del picker, no sólo de EPP). Esta
  // pantalla es el catálogo de EPP, así que muestra sólo las familias cuyos
  // productos lo son.
  const eppFamilies = raw.filter((f) => f.products.some((p) => p.isEpp))

  const families: EppFamilyRow[] = eppFamilies.map((f) => ({
    id: f.id,
    canonicalName: f.canonicalName,
    brand: f.brand,
    model: f.model,
    certification: f.certification,
    lifespanMonths: f.lifespanMonths,
    eppTypeId: f.eppTypeId,
    eppTypeLabel: f.type?.label ?? f.eppType ?? null,
    categoryName: f.category?.name ?? "—",
    totalVariants: f.products.length,
    activeVariants: f.products.filter((p) => p.isActive).length,
    variants: f.products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      attributes: p.productAttributes.map((a) => ({
        name: a.name,
        options: a.options ?? "[]",
      })),
    })),
  }))

  const eppTypes = await db.query.eppTypes.findMany({
    orderBy: (t, { asc }) => [asc(t.sortOrder)],
  })

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de EPP"
        description="Familias de Elementos de Protección Personal por tipo y variante"
      />
      <EppFamilyList families={families} eppTypes={eppTypes} />
    </PageContainer>
  )
}
