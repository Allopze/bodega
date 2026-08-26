import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { ClipboardText } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { costCenters, worksites } from "@/db/schema"
import { costCenterOptionsWhere } from "@/lib/services/cost-centers"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPendingBilling } from "@/lib/services/billing/pending"
import { listActiveClients, listActiveContracts } from "@/lib/services/billing/queries"
import { formatMoney, sumByCurrency } from "@/lib/services/billing/money"
import { formatPeriod, proposalStatusLabel } from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { ProposalDialog } from "../propuestas/proposal-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Pendientes de facturar" }

/**
 * Pendientes de facturar.
 *
 * Qué se muestra y por qué está acotado: la plataforma no tiene un módulo de
 * órdenes de trabajo, así que el pendiente se deriva de lo que sí conoce —
 * contratos mensuales vigentes sin cobro del período, y propuestas aprobadas sin
 * factura. El encabezado lo dice explícitamente para que nadie lea esta pantalla
 * como un inventario completo de trabajo ejecutado.
 */
export default async function PendingBillingPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const canCreate = can(session, "billing:create_proposal")
  const scope = resolveWorksiteScope(session)

  const [items, clients, contracts, worksiteRows, costCenterRows] = await Promise.all([
    listPendingBilling(session),
    canCreate ? listActiveClients() : Promise.resolve([]),
    canCreate ? listActiveContracts() : Promise.resolve([]),
    canCreate
      ? db.select({ id: worksites.id, name: worksites.name })
          .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name))
      : Promise.resolve([]),
    canCreate
      // Los centros de costo tienen faena: el catálogo completo publicaba la
      // estructura de costos de faenas fuera del alcance.
      ? db.select({ id: costCenters.id, name: costCenters.name, code: costCenters.code })
          .from(costCenters)
          .where(costCenterOptionsWhere(scope.mode === "some" ? scope.ids : scope.mode === "none" ? [] : null))
          .orderBy(asc(costCenters.code))
      : Promise.resolve([]),
  ])

  const visibleWorksites = scope.mode === "some"
    ? worksiteRows.filter((worksite) => scope.ids.includes(worksite.id))
    : worksiteRows

  const estimatedTotals = sumByCurrency(
    items
      .filter((item) => item.estimatedAmount !== null)
      .map((item) => ({ currency: item.currency, amount: item.estimatedAmount! })),
  )
  const withoutEstimate = items.filter((item) => item.estimatedAmount === null).length

  return (
    <PageContainer>
      <PageHeader
        title="Pendientes de facturar"
        description="Cobros que corresponden y todavía no tienen factura emitida. Se derivan de los contratos mensuales vigentes y de las propuestas aprobadas: la plataforma no registra servicios ejecutados uno por uno, así que esta lista no reemplaza el control de terreno."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Pendientes de facturar" },
          ]} />
        }
        actions={
          canCreate ? (
            <ProposalDialog
              clients={clients}
              contracts={contracts}
              worksites={visibleWorksites}
              costCenters={costCenterRows}
            />
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={28} />}
          title="Nada pendiente de facturar"
          description="Todos los períodos cerrados de los contratos mensuales vigentes ya tienen factura o propuesta relacionada. Si esperabas ver algo acá, revisa que el contrato exista y tenga ciclo mensual."
          action={
            can(session, "billing:manage_clients") ? (
              <Link href="/facturacion/clientes" className="text-sm font-medium text-[var(--color-primary-ink)] underline underline-offset-2">
                Revisar clientes y contratos
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <section
            aria-label="Resumen de lo pendiente"
            className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm"
          >
            <span className="text-[var(--color-text-muted)]">
              {items.length} {items.length === 1 ? "pendiente" : "pendientes"}
            </span>
            <span className="text-[var(--color-text-muted)]">
              Monto estimado:{" "}
              {estimatedTotals.length === 0
                ? <strong className="text-[var(--color-text)]">sin estimación</strong>
                : estimatedTotals.map((money) => (
                    <strong key={money.currency} className="ml-1 tabular-nums text-[var(--color-text)]">
                      {formatMoney(money.amount, money.currency)}
                    </strong>
                  ))}
            </span>
            {withoutEstimate > 0 && (
              <span className="text-[var(--color-text-subtle)]">
                {withoutEstimate} sin monto definido (contrato variable)
              </span>
            )}
          </section>

          <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <TableRoot className="rounded-none border-0">
              <Table className="text-left">
                <caption className="sr-only">Cobros pendientes de facturar con su motivo y bloqueo</caption>
                <TableHeader>
                  <TableRow className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <TableHead>Cliente</TableHead>
                    <TableHead>Contrato · Faena</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Monto estimado</TableHead>
                    <TableHead>OC del cliente</TableHead>
                    <TableHead>Responsable</TableHead>
                    <TableHead className="text-right">Antigüedad</TableHead>
                    <TableHead>Situación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const proposalStatus = item.proposalStatus ? proposalStatusLabel(item.proposalStatus) : null
                    return (
                      <TableRow key={item.key} className="align-top">
                        <TableCell className="text-[var(--color-text)]">{item.clientName}</TableCell>
                        <TableCell className="text-xs text-[var(--color-text-muted)]">
                          {item.contractCode ?? "Sin contrato"}
                          {item.contractName && <div>{item.contractName}</div>}
                          <div className="text-[var(--color-text-subtle)]">{item.worksiteName ?? "Transversal"}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">
                          {formatPeriod(item.period)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-[var(--color-text)]">
                          {item.estimatedAmount === null
                            ? <span className="text-[var(--color-text-subtle)]">Variable</span>
                            : formatMoney(item.estimatedAmount, item.currency)}
                        </TableCell>
                        <TableCell className="text-xs text-[var(--color-text-muted)]">
                          {item.clientPoNumber ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-[var(--color-text-muted)]">
                          {item.ownerName ?? "Sin asignar"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          <span className={item.ageDays > 45 ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)]"}>
                            {item.ageDays} d
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* Sin propuesta: el motivo y el bloqueo son idénticos en
                              todas las filas (el período ya tiene su columna), así
                              que van al tooltip y no como 3 líneas repetidas
                              (UI/UX 2026-08-05, M4). Con propuesta, el detalle sí
                              varía y se muestra. */}
                          {proposalStatus
                            ? <Badge variant={proposalStatus.tone}>{proposalStatus.label}</Badge>
                            : (
                              <span title={[item.reason, item.blocker].filter(Boolean).join(" · ")}>
                                <Badge variant="neutral">Sin propuesta</Badge>
                              </span>
                            )}
                          {proposalStatus && (
                            <p className="mt-1 max-w-[36ch] text-xs text-[var(--color-text-muted)]">{item.reason}</p>
                          )}
                          {proposalStatus && item.blocker && (
                            <p className="mt-0.5 max-w-[36ch] text-xs text-[var(--color-warning-ink)]">{item.blocker}</p>
                          )}
                          {item.proposalId && (
                            <Link
                              href={`/facturacion/propuestas?propuesta=${item.proposalId}`}
                              className="mt-1 inline-block text-xs font-medium text-[var(--color-primary-ink)] hover:underline"
                            >
                              Ver propuesta
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableRoot>
          </section>
        </>
      )}
    </PageContainer>
  )
}
