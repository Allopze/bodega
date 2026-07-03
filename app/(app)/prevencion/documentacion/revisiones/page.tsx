import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listReviewQueue } from "@/lib/services/prevention-documents-library"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { ReviewQueueView } from "./review-queue-view"

export const metadata: Metadata = { title: "Bandeja de revisión documental" }

export default async function ReviewQueuePage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:docs:approve")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const docs = await listReviewQueue(scope)

  const userIds = Array.from(new Set([
    ...docs.map((d) => d.uploadedBy),
    ...docs.map((d) => d.approvedBy ?? ""),
    ...docs.map((d) => d.responsibleUserId ?? ""),
  ].filter(Boolean) as string[]))
  const worksiteIds = Array.from(new Set(docs.map((d) => d.worksiteId).filter(Boolean) as string[]))
  const [userRows, wsRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
    worksiteIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds)) : Promise.resolve([] as Array<{ id: string; name: string }>),
  ])
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u.name]))
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  const enriched = docs.map((d) => ({
    ...d,
    uploaderName: userMap[d.uploadedBy] ?? d.uploadedBy,
    responsibleName: d.responsibleUserId ? userMap[d.responsibleUserId] ?? null : null,
    worksiteName: d.worksiteId ? wsMap[d.worksiteId] ?? null : null,
  }))

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Bandeja de revisión"
        description="Documentos en revisión o observados que requieren tu decisión."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Documentación", href: "/prevencion/documentacion" },
          { label: "Bandeja de revisión" },
        ]} />}
      />
      <ReviewQueueView documents={enriched} />
    </PageContainer>
  )
}
