import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { CheckCircle } from "@phosphor-icons/react/dist/ssr"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { listOpenDuplicates } from "@/lib/services/billing/duplicates"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { DuplicateReview } from "./duplicate-review"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Posibles duplicados" }

/**
 * Revisión de posibles duplicados.
 *
 * Solo llegan acá los casos **ambiguos**: un duplicado exacto lo resuelve la
 * identidad tributaria sin que nadie intervenga. Lo que se muestra son pares que
 * podrían ser el mismo cobro pero cuya fusión automática podría perder
 * información — y perder información es peor que tener dos filas visibles.
 */
export default async function DuplicatesPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:manage_invoices")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const candidates = await listOpenDuplicates()

  return (
    <PageContainer>
      <PageHeader
        title="Posibles duplicados"
        description="Pares de facturas que podrían ser el mismo documento. La plataforma no los fusiona sola: fusionar mal pierde información, así que la decisión es de una persona."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Posibles duplicados" },
          ]} />
        }
      />

      <DuplicateReview
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          classification: candidate.classification,
          notes: ((candidate.evidence as { notes?: string[] })?.notes) ?? [],
          currency: candidate.currency,
          counterpartyName: candidate.counterpartyName,
          left: {
            id: candidate.invoiceId,
            docType: candidate.docTypeA,
            folio: candidate.folioA,
            issueDate: candidate.issueDateA,
            totalAmount: candidate.totalA,
            paidAmount: candidate.paidA,
            source: candidate.sourceA,
          },
          right: {
            id: candidate.otherInvoiceId,
            docType: candidate.docTypeB,
            folio: candidate.folioB,
            issueDate: candidate.issueDateB,
            totalAmount: candidate.totalB,
            paidAmount: candidate.paidB,
            source: candidate.sourceB,
          },
        }))}
      />

      {candidates.length === 0 && (
        <EmptyState
          icon={<CheckCircle size={28} />}
          title="Sin casos pendientes de revisión"
          description="Ningún par de facturas quedó marcado como posible duplicado. Los duplicados exactos ya se resuelven solos por identidad tributaria."
          tone="success"
        />
      )}
    </PageContainer>
  )
}
