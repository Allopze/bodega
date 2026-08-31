import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq, asc } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentTypes } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { listDocumentCategories } from "@/lib/services/prevention-documents/taxonomy"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { TaxonomyActions } from "./taxonomy-actions"
import { TaxonomyView } from "./taxonomy-list"

export const metadata: Metadata = { title: "Taxonomía documental SST" }

interface PageProps {
  searchParams: Promise<{ category?: string }>
}

export default async function TaxonomySstPage({ searchParams }: PageProps) {
  try {
    await requirePermission("admin:document_taxonomy")
  } catch {
    redirect("/forbidden")
  }

  // `searchParams` y el catálogo no dependen entre sí: se resuelven en paralelo.
  const [params, categories] = await Promise.all([searchParams, listDocumentCategories(false)])
  const activeSlug = params.category && categories.some((c) => c.slug === params.category)
    ? params.category
    : categories[0]?.slug ?? ""

  let typeRows: typeof sstDocumentTypes.$inferSelect[] = []
  if (activeSlug) {
    typeRows = await db.select().from(sstDocumentTypes).where(eq(sstDocumentTypes.categorySlug, activeSlug)).orderBy(asc(sstDocumentTypes.code))
  }

  return (
    <PageContainer>
      <PageHeader
        title="Taxonomía documental SST"
        description="Mantén las categorías y tipos de documentos preventivos que usa toda la organización."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Taxonomía documental SST" },
        ]}
        actions={<TaxonomyActions categorySlug={activeSlug} />}
      />
      <TaxonomyView
        categories={categories.map((c) => ({
          slug: c.slug, name: c.name, description: c.description ?? "",
          sortOrder: c.sortOrder, isActive: c.isActive,
        }))}
        activeSlug={activeSlug}
        types={typeRows.map((t) => ({
          id: t.id,
          categorySlug: t.categorySlug,
          code: t.code,
          name: t.name,
          description: t.description ?? "",
          defaultConfidentiality: t.defaultConfidentiality,
          defaultValidityMonths: t.defaultValidityMonths ?? null,
          requiresApproval: t.requiresApproval,
          requiresAcknowledgment: t.requiresAcknowledgment,
          isActive: t.isActive,
        }))}
      />
    </PageContainer>
  )
}
