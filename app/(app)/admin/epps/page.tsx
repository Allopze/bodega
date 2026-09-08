import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { products } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EppFamilyList } from "./epp-family-list"
import type { EppFamilyRow } from "./epp-family-list"

export const metadata = { title: "Catálogo de EPP" }

export default async function EppsPage() {
  try { await requirePermission("admin:products") }
  catch { redirect("/forbidden") }

  // `epp_product_families` ahora también agrupa variantes de productos que no
  // son EPP (es el mecanismo de agrupación del picker, no sólo de EPP). Esta
  // pantalla es el catálogo de EPP, así que muestra sólo las familias con al
  // menos un producto EPP. El filtro va en SQL: antes se traía el catálogo
  // completo —familias × productos × atributos— para descartar en JS las que no
  // correspondían, y los atributos no los usaba nadie.
  const eppFamilyIds = db
    .selectDistinct({ id: products.familyId })
    .from(products)
    .where(eq(products.isEpp, true))

  const eppFamilies = await db.query.eppProductFamilies.findMany({
    where: (f) => inArray(f.id, eppFamilyIds),
    with: {
      category: true,
      type: true,
      products: { orderBy: (p, { asc }) => [asc(p.name)] },
    },
    orderBy: (f, { asc }) => [asc(f.canonicalName)],
  })

  const families: EppFamilyRow[] = eppFamilies.map((f) => ({
    id: f.id,
    canonicalName: f.canonicalName,
    brand: f.brand,
    model: f.model,
    certification: f.certification,
    lifespanMonths: f.lifespanMonths,
    lifespanNotApplicable: f.lifespanNotApplicable,
    pictogramUrl: f.pictogramUrl,
    eppTypeId: f.eppTypeId,
    // Sin fallback a `eppType`: esa columna deprecada guarda vocabulario de
    // ítem ("casco") y ésta muestra zona corporal ("Cabeza"). Mezclarlos hacía
    // parecer clasificada una familia cuyo `eppTypeId` sigue nulo.
    eppTypeLabel: f.type?.label ?? null,
    categoryName: f.category?.name ?? "—",
    categoryId: f.categoryId,
    totalVariants: f.products.length,
    activeVariants: f.products.filter((p) => p.isActive).length,
    variants: f.products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
  }))

  const [eppTypes, categories] = await Promise.all([
    db.query.eppTypes.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] }),
    db.query.productCategories.findMany({ orderBy: (c, { asc }) => [asc(c.sortOrder), asc(c.name)] }),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de EPP"
        description="Familias de Elementos de Protección Personal por tipo y variante"
      />
      <EppFamilyList families={families} eppTypes={eppTypes} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </PageContainer>
  )
}
