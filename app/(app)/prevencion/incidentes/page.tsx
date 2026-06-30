import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listIncidents } from "@/lib/services/prevention-incidents"
import { listScopedWorksites } from "@/lib/services/ppa"
import { db } from "@/db"
import { workers } from "@/db/schema/worksites"
import { inArray } from "drizzle-orm"
import { PageContainer } from "@/components/ui/page-container"
import { IncidentPanel } from "./incident-panel"

export const metadata: Metadata = { title: "Incidentes" }

export default async function IncidentesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:incidents:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  const [incidents, worksites] = await Promise.all([
    listIncidents(worksiteIds),
    listScopedWorksites(worksiteIds),
  ])

  const workerIds = Array.from(new Set(incidents.map((i) => i.workerId).filter(Boolean) as string[]))
  const workerRows = workerIds.length > 0
    ? await db
      .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
      .from(workers)
      .where(inArray(workers.id, workerIds))
    : []
  const workerMap = Object.fromEntries(workerRows.map((w) => [w.id, w]))
  const incidentsWithWorker = incidents.map((i) => ({
    ...i,
    worker: i.workerId ? workerMap[i.workerId] ?? null : null,
  }))

  const canManage = can(session, "prevention:incidents:manage")
  const canClose = can(session, "prevention:incidents:close")

  return (
    <PageContainer>
      <IncidentPanel
        incidents={incidentsWithWorker}
        worksites={worksites}
        canManage={canManage}
        canClose={canClose}
      />
    </PageContainer>
  )
}
