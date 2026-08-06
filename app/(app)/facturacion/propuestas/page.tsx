import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { FolderOpen } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { costCenters, worksites } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listProposals } from "@/lib/services/billing/proposals"
import { listActiveClients, listActiveContracts, listInvoices, todayIso } from "@/lib/services/billing/queries"
import { formatMoney } from "@/lib/services/billing/money"
import { formatDateTime, formatPeriod, proposalStatusLabel } from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { ProposalDialog } from "./proposal-dialog"
import { ProposalActions } from "./proposal-actions"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Propuestas de facturación" }

/**
 * Propuestas de facturación: la preparación interna del cobro.
 *
 * El flujo separa a quien prepara de quien aprueba. Aprobar aquí **no** emite un
 * documento tributario: solo autoriza internamente el cobro y deja la propuesta
 * lista para que alguien la emita en el portal y la relacione con la factura.
 */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; cliente?: string; periodo?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const filters = await searchParams
  const canCreate = can(session, "billing:create_proposal")
  const canLink = can(session, "billing:manage_invoices")
  const scope = resolveWorksiteScope(session)

  const [proposals, clients, contracts, worksiteRows, costCenterRows, invoiceOptions] = await Promise.all([
    listProposals(session, {
      status: filters.estado,
      clientId: filters.cliente,
      period: filters.periodo,
    }),
    canCreate ? listActiveClients() : Promise.resolve([]),
    canCreate ? listActiveContracts() : Promise.resolve([]),
    canCreate
      ? db.select({ id: worksites.id, name: worksites.name })
          .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name))
      : Promise.resolve([]),
    canCreate
      ? db.select({ id: costCenters.id, name: costCenters.name, code: costCenters.code })
          .from(costCenters).where(eq(costCenters.isActive, true)).orderBy(asc(costCenters.code))
      : Promise.resolve([]),
    // Facturas candidatas para relacionar: las emitidas sin propuesta asociada.
    canLink
      ? listInvoices(session, "sale", { pageSize: 200 }).then((result) => result.rows.map((row) => ({
          id: row.id,
          label: `Folio ${row.folio} · ${row.counterpartyName} · ${formatMoney(row.totalAmount, row.currency)}`,
        })))
      : Promise.resolve([]),
  ])

  const visibleWorksites = scope.mode === "some"
    ? worksiteRows.filter((worksite) => scope.ids.includes(worksite.id))
    : worksiteRows

  return (
    <PageContainer>
      <PageHeader
        title="Propuestas de facturación"
        description="Preparación interna del cobro: qué se va a facturar, por cuánto y con qué respaldo. Quien prepara no puede aprobar su propia propuesta, y aprobar no emite ningún documento tributario."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Propuestas" },
          ]} />
        }
        actions={
          canCreate ? (
            <ProposalDialog
              clients={clients}
              contracts={contracts}
              worksites={visibleWorksites}
              costCenters={costCenterRows}
              defaultPeriod={todayIso().slice(0, 7)}
            />
          ) : undefined
        }
      />

      {proposals.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} />}
          title="Todavía no hay propuestas"
          description="Una propuesta reúne lo que corresponde cobrar de un período antes de que exista la factura. Empieza desde Pendientes de facturar, que muestra los períodos de contrato sin cobrar."
        />
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Propuestas de facturación con su estado y acciones disponibles</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  <th scope="col" className="px-4 py-2.5 th-type">Código</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Cliente</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Contrato · Faena</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Período</th>
                  <th scope="col" className="px-4 py-2.5 th-type text-right">Total estimado</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Estado</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {proposals.map((proposal) => {
                  const status = proposalStatusLabel(proposal.status)
                  return (
                    <tr key={proposal.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-[var(--color-text)]">
                        {proposal.code}
                        <div className="text-xs font-normal text-[var(--color-text-subtle)]">
                          {proposal.itemCount} {proposal.itemCount === 1 ? "ítem" : "ítems"}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text)]">{proposal.clientName}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                        {proposal.contractCode ?? "Sin contrato"}
                        <div className="text-[var(--color-text-subtle)]">{proposal.worksiteName ?? "Transversal"}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)]">
                        {formatPeriod(proposal.servicePeriod)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-[var(--color-text)]">
                        {formatMoney(proposal.estimatedTotal, proposal.currency)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={status.tone}>{status.label}</Badge>
                        {proposal.missingDocuments && (
                          <p className="mt-1 max-w-[28ch] text-xs text-[var(--color-warning-ink)]">
                            Antecedentes pendientes: {proposal.missingDocuments}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                          Actualizada {formatDateTime(proposal.updatedAt)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <ProposalActions
                          proposalId={proposal.id}
                          code={proposal.code}
                          status={proposal.status}
                          hasMissingDocuments={Boolean(proposal.missingDocuments)}
                          canCreate={canCreate}
                          canReview={can(session, "billing:review_proposal")}
                          canApprove={can(session, "billing:approve_proposal")}
                          canLink={canLink}
                          invoiceOptions={invoiceOptions}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PageContainer>
  )
}
