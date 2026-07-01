import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { contractorWorkers, contractorDocuments, workers } from "@/db/schema"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listContractors, getExpiringContractorDocuments } from "@/lib/services/prevention-contractors"
import { PageContainer } from "@/components/ui/page-container"
import { ContratistasPanel } from "./contratistas-panel"

export const metadata: Metadata = { title: "Contratistas" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function ContratistasPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:contractors:view")) redirect("/forbidden")

  const canManage = can(session, "prevention:contractors:manage")
  const contractors = await listContractors()
  const contractorIds = contractors.map((c) => c.id)
  const scope = scopeToIds(resolveWorksiteScope(session))

  const [contractorWorkerRows, contractorDocumentRows, expiringDocuments, availableWorkers] = await Promise.all([
    contractorIds.length ? db.select().from(contractorWorkers).where(inArray(contractorWorkers.contractorId, contractorIds)) : Promise.resolve([]),
    contractorIds.length ? db.select().from(contractorDocuments).where(inArray(contractorDocuments.contractorId, contractorIds)) : Promise.resolve([]),
    getExpiringContractorDocuments(30),
    canManage
      ? (scope !== "all" && scope.length === 0
          ? Promise.resolve([])
          : db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
              .from(workers)
              .where(scope === "all" ? eq(workers.isActive, true) : and(eq(workers.isActive, true), inArray(workers.worksiteId, scope)))
              .orderBy(workers.firstName))
      : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <ContratistasPanel
        contractors={contractors}
        workers={contractorWorkerRows}
        documents={contractorDocumentRows}
        availableWorkers={availableWorkers}
        expiringDocumentIds={new Set(expiringDocuments.map((d) => d.id))}
        canManage={canManage}
      />
    </PageContainer>
  )
}
