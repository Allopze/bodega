import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, inArray } from "drizzle-orm"
import { db } from "@/db"
import { workers } from "@/db/schema"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getEppMatrix, listEppDeliveries } from "@/lib/services/prevention-epp-matrix"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { EppMatrizPanel } from "./epp-matriz-panel"

export const metadata: Metadata = { title: "Matriz EPP por cargo" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EppMatrizPage({ searchParams }: { searchParams: Promise<{ faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:epp_matrix:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const worksites = await listScopedWorksites(scope)
  const selectedWorksiteId = worksites.find((w) => w.id === query.faena)?.id ?? worksites[0]?.id

  let entries: Array<{ id: string; position: string; eppProductId: string; riskId: string | null; notes: string | null }> = []
  let deliveries: Array<{ id: string; workerId: string; eppProductId: string; deliveredAt: string; evidenceUrl: string | null; acknowledgedAt: string | null }> = []
  let worksiteWorkers: Array<{ id: string; firstName: string; lastName: string; rut: string | null }> = []
  if (selectedWorksiteId) {
    [entries, deliveries, worksiteWorkers] = await Promise.all([
      getEppMatrix(selectedWorksiteId, scope),
      listEppDeliveries(selectedWorksiteId, scope),
      db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
        .from(workers)
        .where(inArray(workers.worksiteId, [selectedWorksiteId]))
        .orderBy(asc(workers.firstName), asc(workers.lastName)),
    ])
  }

  const canManage = can(session, "prevention:epp_matrix:manage")

  return (
    <PageContainer>
      <EppMatrizPanel
        entries={entries}
        deliveries={deliveries}
        worksites={worksites}
        workers={worksiteWorkers}
        selectedWorksiteId={selectedWorksiteId}
        canManage={canManage}
        exportHref={`/api/prevencion/epp/matriz/export?faena=${selectedWorksiteId ?? ""}`}
      />
    </PageContainer>
  )
}
