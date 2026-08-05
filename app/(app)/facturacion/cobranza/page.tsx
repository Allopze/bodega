import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { CurrencyDollar } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { users } from "@/db/schema"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getCollectionsView, listPendingSuggestions } from "@/lib/services/billing/collections"
import { formatMoney } from "@/lib/services/billing/money"
import {
  actionTypeLabel,
  collectionStatusLabel,
  docTypeShortLabel,
  dueStatusLabel,
  formatDateShort,
  paymentStatusLabel,
} from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { CollectionActionDialog } from "./collection-action-dialog"
import { SuggestionsPanel } from "./suggestions-panel"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Cobranza" }

/**
 * Vista de cobranza: qué hay que hacer hoy y con qué factura.
 *
 * Las facturas se agrupan por situación (en disputa, con compromiso, vencidas,
 * próximas a vencer…) porque la acción que corresponde es distinta en cada
 * grupo. Un solo listado ordenado por fecha no dice qué hacer.
 */
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ grupo?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const { grupo } = await searchParams
  const canManage = can(session, "billing:manage_collections")
  const canConfirm = can(session, "billing:confirm_payments")

  const [view, suggestions, userRows] = await Promise.all([
    getCollectionsView(session),
    canConfirm ? listPendingSuggestions(session) : Promise.resolve([]),
    canManage
      ? db.select({ id: users.id, name: users.name })
          .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name))
      : Promise.resolve([]),
  ])

  const activeBucket = view.buckets.find((bucket) => bucket.id === grupo)
  const rows = activeBucket ? view.rows.filter((row) => row.bucket === activeBucket.id) : view.rows

  return (
    <PageContainer>
      <PageHeader
        title="Cobranza"
        description="Estado de cobro de las facturas emitidas, agrupado por lo que corresponde hacer con cada una. Solo los pagos confirmados por una persona descuentan del saldo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Cobranza" },
          ]} />
        }
      />

      {view.rows.length === 0 ? (
        <EmptyState
          icon={<CurrencyDollar size={28} />}
          title="No hay facturas que cobrar"
          description="Cuando se sincronicen facturas de venta aparecerán acá agrupadas por su situación de cobro."
        />
      ) : (
        <>
          {/* ── Grupos ────────────────────────────────────────────────────── */}
          <nav aria-label="Situaciones de cobranza" className="flex flex-wrap gap-2">
            <GroupChip href="/facturacion/cobranza" active={!activeBucket} label="Todas" count={view.rows.length} />
            {view.buckets
              .filter((bucket) => bucket.count > 0)
              .map((bucket) => (
                <GroupChip
                  key={bucket.id}
                  href={`/facturacion/cobranza?grupo=${bucket.id}`}
                  active={activeBucket?.id === bucket.id}
                  label={bucket.label}
                  count={bucket.count}
                  amount={bucket.byCurrency[0]}
                  title={bucket.description}
                />
              ))}
          </nav>

          {activeBucket && (
            <p className="text-sm text-[var(--color-text-muted)]">{activeBucket.description}</p>
          )}

          <section
            aria-label="Saldo pendiente total"
            className="flex flex-wrap items-baseline gap-x-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm"
          >
            <span className="text-[var(--color-text-muted)]">
              Pendiente de cobro:{" "}
              {view.totalOutstanding.length === 0
                ? <strong className="text-[var(--color-text)]">sin saldo</strong>
                : view.totalOutstanding.map((money) => (
                    <strong key={money.currency} className="ml-1 tabular-nums text-[var(--color-text)]">
                      {formatMoney(money.amount, money.currency)}
                    </strong>
                  ))}
            </span>
            <span className="text-[var(--color-text-subtle)]">Al {formatDateShort(view.today)}</span>
          </section>

          {/* ── Sugerencias de conciliación ───────────────────────────────── */}
          {canConfirm && (
            <SuggestionsPanel
              suggestions={suggestions.map((suggestion) => ({
                paymentId: suggestion.paymentId,
                invoiceId: suggestion.invoiceId,
                folio: suggestion.folio,
                clientName: suggestion.clientName,
                paymentDate: suggestion.paymentDate,
                amount: suggestion.amount,
                currency: suggestion.currency,
                confidence: suggestion.confidence,
                evidence: (suggestion.evidence as { evidence?: string[]; warnings?: string[] }) ?? {},
                outstandingAmount: suggestion.invoiceTotal - suggestion.invoicePaid,
              }))}
            />
          )}

          {/* ── Tabla ─────────────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Facturas por cobrar con su situación y última gestión</caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <th scope="col" className="px-4 py-2.5 th-type">Documento</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Cliente</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Vencimiento</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Saldo</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Situación</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Última gestión</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Responsable</th>
                    {canManage && <th scope="col" className="px-4 py-2.5 th-type">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {rows.map((row) => {
                    const payment = paymentStatusLabel(row.paymentStatus)
                    const collection = collectionStatusLabel(row.collectionStatus)
                    const due = dueStatusLabel(row.daysOverdue, row.paymentStatus)
                    return (
                      <tr key={row.invoiceId} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Link href={`/facturacion/facturas/${row.invoiceId}`} className="font-medium text-[var(--color-text)] hover:underline">
                            {docTypeShortLabel(row.docType)} {row.folio}
                          </Link>
                          {row.suggestedPayments > 0 && (
                            <div className="text-xs text-[var(--color-info-ink)]">
                              {row.suggestedPayments} pago(s) sugerido(s)
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="max-w-[22ch] truncate text-[var(--color-text)]">{row.clientName}</div>
                          <div className="text-xs text-[var(--color-text-subtle)]">
                            {row.contractCode ?? row.clientTaxId}
                            {row.worksiteName && ` · ${row.worksiteName}`}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <div className="tabular-nums text-[var(--color-text-muted)]">{formatDateShort(row.dueDate)}</div>
                          {due && (
                            <div className={due.tone === "danger" ? "text-xs text-[var(--color-danger-ink)]" : "text-xs text-[var(--color-text-subtle)]"}>
                              {due.label}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <div className="tabular-nums font-medium text-[var(--color-text)]">
                            {formatMoney(row.outstandingAmount, row.currency)}
                          </div>
                          {row.paidAmount !== 0 && (
                            <div className="text-xs tabular-nums text-[var(--color-text-subtle)]">
                              cobrado {formatMoney(row.paidAmount, row.currency)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={payment.tone}>{payment.label}</Badge>
                            {row.collectionStatus !== "none" && (
                              <Badge variant={collection.tone}>{collection.label}</Badge>
                            )}
                          </div>
                          {row.commitmentDate && (
                            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                              Comprometido para el {formatDateShort(row.commitmentDate)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {row.lastActionDate
                            ? <>
                                {actionTypeLabel(row.lastActionType ?? "")} · {formatDateShort(row.lastActionDate)}
                                <div className="text-[var(--color-text-subtle)]">hace {row.daysSinceLastAction} días</div>
                              </>
                            : <span className="text-[var(--color-text-subtle)]">Sin gestión registrada</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {row.ownerName ?? "Sin asignar"}
                        </td>
                        {canManage && (
                          <td className="px-4 py-2.5">
                            <CollectionActionDialog
                              invoiceId={row.invoiceId}
                              folio={row.folio}
                              currency={row.currency}
                              outstandingAmount={row.outstandingAmount}
                              users={userRows}
                              canConfirmPayments={canConfirm}
                              today={view.today}
                            />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </PageContainer>
  )
}

function GroupChip({
  href,
  active,
  label,
  count,
  amount,
  title,
}: {
  href: string
  active: boolean
  label: string
  count: number
  amount?: { currency: string; amount: number }
  title?: string
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      className={[
        "rounded-[var(--radius-lg)] border px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)]",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-primary)]",
      ].join(" ")}
    >
      {label}
      <span className="ml-1.5 tabular-nums text-[var(--color-text-muted)]">{count}</span>
      {amount && (
        <span className="ml-1.5 text-xs tabular-nums text-[var(--color-text-subtle)]">
          {formatMoney(amount.amount, amount.currency)}
        </span>
      )}
    </Link>
  )
}
