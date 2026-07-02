import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listDocumentCategories, listDocumentTypes } from "@/lib/services/prevention-documents-library"
import { listScopedWorksites } from "@/lib/services/ppa"
import { db } from "@/db"
import { users } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { NewDocumentForm } from "./new-document-form"

export const metadata: Metadata = { title: "Nuevo documento SST" }

export default async function NewDocumentPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:manage")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const [categories, types, worksites, userRows] = await Promise.all([
    listDocumentCategories(true),
    listDocumentTypes(),
    listScopedWorksites(worksiteIds),
    db.select({ id: users.id, name: users.name }).from(users),
  ])

  return (
    <PageContainer width="workbench">
      <Breadcrumbs items={[
        { label: "Prevención", href: "/prevencion" },
        { label: "Biblioteca SST", href: "/prevencion/biblioteca" },
        { label: "Nuevo documento" },
      ]} />
      <PageHeader
        title="Nuevo documento"
        description="Crea la cabecera del documento. Luego podrás subir el archivo (PDF/JPG/PNG/XML) en la página de detalle."
      />
      <NewDocumentForm
        categories={categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }))}
        types={types.map((t) => ({
          id: t.id,
          categorySlug: t.categorySlug,
          code: t.code,
          name: t.name,
          defaultConfidentiality: t.defaultConfidentiality,
          defaultValidityMonths: t.defaultValidityMonths,
        }))}
        worksites={worksites.map((w: { id: string; name: string }) => ({ id: w.id, name: w.name }))}
        users={userRows.map((u) => ({ id: u.id, name: u.name }))}
      />
    </PageContainer>
  )
}
