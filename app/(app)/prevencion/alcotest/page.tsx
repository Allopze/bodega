import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers } from "@/db/schema/worksites"
import { listAlcoholTests, getAlcoholTestStats } from "@/lib/services/prevention-alcohol-tests"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { AlcotestPanel } from "./alcotest-panel"

export const metadata: Metadata = { title: "Control de alcotest" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function AlcotestPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:alcohol_tests:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))

  const [tests, worksites, workerRows, stats] = await Promise.all([
    listAlcoholTests(scope),
    listScopedWorksites(scope),
    scope !== "all" && scope.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName })
          .from(workers)
          .where(scope === "all" ? undefined : inArray(workers.worksiteId, scope))
          .orderBy(asc(workers.firstName), asc(workers.lastName)),
    getAlcoholTestStats(scope),
  ])

  const canManage = can(session, "prevention:alcohol_tests:manage")

  return (
    <PageContainer>
      <AlcotestPanel
        tests={tests}
        worksites={worksites}
        workers={workerRows}
        stats={stats}
        canManage={canManage}
      />
    </PageContainer>
  )
}
