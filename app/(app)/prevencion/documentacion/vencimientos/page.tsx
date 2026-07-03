import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getExpiringDocuments } from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { ExpiringView } from "./expiring-view"

export const metadata: Metadata = { title: "Vencimientos documentales SST" }

export default async function ExpirationsPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const expiring = await getExpiringDocuments(scope, 90, 200)

  const userIds = Array.from(new Set(expiring.map((e) => e.responsibleUserId).filter(Boolean) as string[]))
  const worksiteIds = Array.from(new Set(expiring.map((e) => e.worksiteId).filter(Boolean) as string[]))
  const [userRows, wsRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u.name]))
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  const enriched = expiring.map((e) => ({
    ...e,
    responsibleName: e.responsibleUserId ? userMap[e.responsibleUserId] ?? null : null,
    worksiteName: e.worksiteId ? wsMap[e.worksiteId] ?? null : null,
  }))

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Vencimientos documentales"
        description="Documentos vigentes próximos a vencer, vencidos y por vencer en los próximos 90 días."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Documentación", href: "/prevencion/documentacion" },
          { label: "Vencimientos" },
        ]} />}
      />
      <ExpiringView documents={enriched} />
    </PageContainer>
  )
}
