import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { listLegalDocuments } from "@/lib/services/prevention-legal-docs"
import { db } from "@/db"
import { legalDocumentVersions, documentDeliveries, workers } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { DocumentacionPanel } from "./documentacion-panel"

export const metadata: Metadata = { title: "Documentación legal" }

export default async function DocumentacionPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:legal_docs:view")) redirect("/forbidden")

  const docs = await listLegalDocuments()
  const docIds = docs.map((d) => d.id)

  const versions = docIds.length
    ? await db.select().from(legalDocumentVersions).where(inArray(legalDocumentVersions.documentId, docIds))
    : []
  const versionIds = versions.map((v) => v.id)

  const deliveries = versionIds.length
    ? await db.select().from(documentDeliveries).where(inArray(documentDeliveries.versionId, versionIds))
    : []

  const workerIds = Array.from(new Set(deliveries.map((d) => d.workerId)))
  const workerRows = workerIds.length
    ? await db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
        .from(workers).where(inArray(workers.id, workerIds))
    : []
  const workerMap = Object.fromEntries(workerRows.map((w) => [w.id, w]))

  const enrichedDeliveries = deliveries.map((d) => ({
    ...d,
    worker: workerMap[d.workerId] ?? null,
  }))

  const canManage = can(session, "prevention:legal_docs:manage")
  const canSign = can(session, "prevention:legal_docs:sign")

  // Solo se necesita el listado completo de trabajadores activos para el
  // formulario de entrega, que únicamente ve quien puede gestionar.
  const activeWorkers = canManage
    ? await db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut })
        .from(workers).where(eq(workers.isActive, true)).orderBy(workers.firstName)
    : []

  return (
    <PageContainer>
      <DocumentacionPanel
        documents={docs}
        versions={versions}
        deliveries={enrichedDeliveries}
        activeWorkers={activeWorkers}
        canManage={canManage}
        canSign={canSign}
      />
    </PageContainer>
  )
}
