import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { contractorWorkers, contractorDocuments, workers } from "@/db/schema"
import { requireAuth, can } from "@/lib/auth/can"
import { listContractors, getExpiringContractorDocuments } from "@/lib/services/prevention-contractors"
import { PageContainer } from "@/components/ui/page-container"
import { ContratistasPanel } from "./contratistas-panel"

export const metadata: Metadata = { title: "Contratistas" }

export default async function ContratistasPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:contractors:view")) redirect("/forbidden")

  const canManage = can(session, "prevention:contractors:manage")
  const contractors = await listContractors()
  const contractorIds = contractors.map((c) => c.id)

  const [contractorWorkerRows, contractorDocumentRows, expiringDocuments, availableWorkers] = await Promise.all([
    contractorIds.length ? db.select().from(contractorWorkers).where(inArray(contractorWorkers.contractorId, contractorIds)) : Promise.resolve([]),
    contractorIds.length ? db.select().from(contractorDocuments).where(inArray(contractorDocuments.contractorId, contractorIds)) : Promise.resolve([]),
    getExpiringContractorDocuments(30),
    canManage
      ? db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
          .from(workers).where(eq(workers.isActive, true)).orderBy(workers.firstName)
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
