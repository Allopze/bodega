import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { Buildings } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { costCenters, users, worksites } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { listClientsWithContracts } from "@/lib/services/billing/queries"
import { formatMoney } from "@/lib/services/billing/money"
import { formatDateShort } from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { ClientContractManager } from "./client-contract-manager"
import { Table, TableRoot } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Clientes y contratos" }

/**
 * Maestro comercial: a quién le factura Chome y bajo qué contrato.
 *
 * Es el dominio que faltaba por completo en la plataforma y sin el cual las
 * preguntas "¿cuánto se facturó por contrato?" o "¿por faena?" no tienen
 * respuesta posible. El plazo de pago definido acá es lo que permite derivar el
 * vencimiento de una factura que no lo declara.
 */
export default async function ClientsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:manage_clients")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const [clientRows, worksiteRows, costCenterRows, userRows] = await Promise.all([
    listClientsWithContracts(),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select({ id: costCenters.id, name: costCenters.name, code: costCenters.code })
      .from(costCenters).where(eq(costCenters.isActive, true)).orderBy(asc(costCenters.code)),
    db.select({ id: users.id, name: users.name })
      .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name)),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Clientes y contratos"
        description="Maestro comercial de Chome. El plazo de pago del contrato (o del cliente) es lo que permite calcular el vencimiento de una factura que no lo trae declarado."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Clientes y contratos" },
          ]} />
        }
        actions={
          <ClientContractManager
            clients={clientRows.map((client) => ({ id: client.id, name: client.name }))}
            worksites={worksiteRows}
            costCenters={costCenterRows}
            users={userRows}
          />
        }
      />

      {clientRows.length === 0 ? (
        <EmptyState
          icon={<Buildings size={28} />}
          title="Todavía no hay clientes registrados"
          description="Registra al menos un cliente para poder atribuir las facturas emitidas y calcular vencimientos a partir de su plazo de pago."
        />
      ) : (
        <div className="space-y-3">
          {clientRows.map((client) => (
            <article
              key={client.id}
              className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
            >
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                    {client.name}
                    {!client.isActive && <MetaBadge meta={{ label: "Inactivo", variant: "neutral" }} />}
                  </h2>
                  <p className="text-xs tabular-nums text-[var(--color-text-muted)]">
                    {client.rut}
                    {client.email && ` · ${client.email}`}
                    {client.phone && ` · ${client.phone}`}
                  </p>
                </div>
                <div className="text-right text-xs text-[var(--color-text-muted)]">
                  <p>
                    Plazo de pago:{" "}
                    <strong className="text-[var(--color-text)]">
                      {client.paymentTermsDays === null ? "sin definir" : `${client.paymentTermsDays} días`}
                    </strong>
                  </p>
                  <p>Moneda habitual: {client.defaultCurrency}</p>
                  {client.ownerName && <p>Responsable: {client.ownerName}</p>}
                  <Link
                    href={`/facturacion/facturas?cliente=${client.id}`}
                    className="mt-1 inline-block font-medium text-[var(--color-primary-ink)] hover:underline"
                  >
                    Ver sus facturas
                  </Link>
                </div>
              </header>

              {client.contracts.length === 0 ? (
                <p className="px-4 py-3 text-sm text-[var(--color-text-muted)]">
                  Sin contratos registrados. Las facturas de este cliente se pueden vincular igual, pero no habrá reporte por contrato.
                </p>
              ) : (
                <TableRoot className="rounded-none border-0">
                  <Table className="text-left text-sm">
                    <caption className="sr-only">Contratos de {client.name}</caption>
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th scope="col" className="px-4 py-2 th-type">Código</th>
                        <th scope="col" className="px-4 py-2 th-type">Contrato</th>
                        <th scope="col" className="px-4 py-2 th-type">Faena</th>
                        <th scope="col" className="px-4 py-2 th-type">Vigencia</th>
                        <th scope="col" className="px-4 py-2 th-type">Ciclo</th>
                        <th scope="col" className="px-4 py-2 th-type text-right">Monto del período</th>
                        <th scope="col" className="px-4 py-2 th-type text-right">Plazo</th>
                        <th scope="col" className="px-4 py-2 th-type">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {client.contracts.map((contract) => (
                        <tr key={contract.id}>
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-[var(--color-text)]">{contract.code}</td>
                          <td className="px-4 py-2 text-[var(--color-text)]">{contract.name}</td>
                          <td className="px-4 py-2 text-[var(--color-text-muted)]">{contract.worksiteName ?? "Transversal"}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-[var(--color-text-muted)]">
                            {formatDateShort(contract.startDate)} → {formatDateShort(contract.endDate)}
                          </td>
                          <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                            {CYCLE_LABELS[contract.billingCycle] ?? contract.billingCycle}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-[var(--color-text)]">
                            {contract.periodAmount === null ? "Variable" : formatMoney(contract.periodAmount, contract.currency)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                            {contract.paymentTermsDays === null ? "—" : `${contract.paymentTermsDays} d`}
                          </td>
                          <td className="px-4 py-2">
                            <MetaBadge meta={metaFor(CONTRACT_STATUS_META, contract.status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableRoot>
              )}
            </article>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

const CYCLE_LABELS: Record<string, string> = {
  monthly:   "Mensual",
  milestone: "Por hito",
  none:      "Sin calendario",
}

/** Label + variante en un solo mapa: el color lo decide el estado, no cada página. */
const CONTRACT_STATUS_META: Record<string, StateMetaInput> = {
  active:    { label: "Vigente",    variant: "success" },
  suspended: { label: "Suspendido", variant: "warning" },
  closed:    { label: "Cerrado",    variant: "neutral" },
}
