import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Receipt } from "@phosphor-icons/react/dist/ssr"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { listInvoices, listActiveClients, type InvoiceFilters } from "@/lib/services/billing/queries"
import { formatMoney } from "@/lib/services/billing/money"
import {
  collectionStatusLabel,
  docTypeShortLabel,
  documentStatusLabel,
  dueStatusLabel,
  formatDateShort,
  formatDateTime,
  paymentStatusLabel,
  providerLabel,
} from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { InvoiceFiltersBar } from "./invoice-filters"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Facturas emitidas" }

const PAGE_SIZE = 50

/**
 * Facturas de VENTA. La dirección es fija: las facturas de proveedor viven en
 * Compras y no se mezclan acá ni con un filtro.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion/facturas")}`)
  }

  const params = await searchParams
  const page = Math.max(1, Number.parseInt(params.pagina ?? "1", 10) || 1)

  const filters: InvoiceFilters = {
    period: matches(params.periodo, /^\d{4}-(0[1-9]|1[0-2])$/),
    clientId: params.cliente || undefined,
    paymentStatus: oneOf(params.pago, ["unpaid", "partial", "paid", "overpaid"] as const),
    documentStatus: oneOf(params.documento, ["issued", "accepted", "rejected", "void", "draft", "unknown"] as const),
    source: oneOf(params.fuente, ["factura_en_linea", "chipax", "manual"] as const),
    currency: matches(params.moneda, /^[A-Z]{3}$/),
    overdueOnly: params.vencidas === "1",
    search: params.q?.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  }

  const [result, clients] = await Promise.all([
    listInvoices(session, "sale", filters),
    listActiveClients(),
  ])

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const hasFilters = Object.entries(params).some(([key, value]) => key !== "pagina" && Boolean(value))

  return (
    <PageContainer>
      <PageHeader
        title="Facturas emitidas"
        description="Documentos de venta de Chome. La información tributaria viene de la fuente externa y no se edita acá; el vínculo con cliente, contrato y faena sí es interno."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación", href: "/facturacion" },
            { label: "Facturas emitidas" },
          ]} />
        }
      />

      <InvoiceFiltersBar clients={clients} />

      {/* Totales del conjunto filtrado completo, no solo de la página visible. */}
      {result.total > 0 && (
        <section
          aria-label="Totales del filtro aplicado"
          className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm"
        >
          <span className="text-[var(--color-text-muted)]">
            {result.total} {result.total === 1 ? "factura" : "facturas"}
          </span>
          <span className="text-[var(--color-text-muted)]">
            Facturado:{" "}
            {result.totalsByCurrency.map((money) => (
              <strong key={money.currency} className="ml-1 tabular-nums text-[var(--color-text)]">
                {formatMoney(money.amount, money.currency)}
              </strong>
            ))}
          </span>
          <span className="text-[var(--color-text-muted)]">
            Pendiente de cobro:{" "}
            {result.outstandingByCurrency.map((money) => (
              <strong key={money.currency} className="ml-1 tabular-nums text-[var(--color-text)]">
                {formatMoney(money.amount, money.currency)}
              </strong>
            ))}
          </span>
        </section>
      )}

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title={hasFilters ? "Ninguna factura coincide con el filtro" : "Todavía no hay facturas emitidas"}
          description={
            hasFilters
              ? "Prueba quitando algún filtro o cambiando el período."
              : "El módulo se alimenta del libro de ventas de FacturaEnLínea. Sincroniza un período para verlas acá."
          }
          action={
            hasFilters ? (
              <Link href="/facturacion/facturas" className="text-sm font-medium text-[var(--color-primary-ink)] underline underline-offset-2">
                Quitar filtros
              </Link>
            ) : can(session, "billing:manage_sync") ? (
              <Link href="/facturacion/sincronizacion" className="text-sm font-medium text-[var(--color-primary-ink)] underline underline-offset-2">
                Ir a Sincronización
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Facturas emitidas con su cliente, montos, estado de pago y estado de cobranza
                </caption>
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                    <th scope="col" className="px-4 py-2.5 th-type">Documento</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Cliente</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Emisión</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Vencimiento</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Neto</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">IVA</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Total</th>
                    <th scope="col" className="px-4 py-2.5 th-type text-right">Saldo</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Estado</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Contrato · Faena</th>
                    <th scope="col" className="px-4 py-2.5 th-type">Fuente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {result.rows.map((row) => {
                    const document = documentStatusLabel(row.documentStatus)
                    const payment = paymentStatusLabel(row.paymentStatus)
                    const collection = collectionStatusLabel(row.collectionStatus)
                    const due = dueStatusLabel(row.daysOverdue, row.paymentStatus)
                    return (
                      <tr key={row.id} className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]">
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Link href={`/facturacion/facturas/${row.id}`} className="font-medium text-[var(--color-text)] hover:underline">
                            {docTypeShortLabel(row.docType)} {row.folio}
                          </Link>
                          <div className="text-xs text-[var(--color-text-subtle)]">{document.label}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="max-w-[22ch] truncate text-[var(--color-text)]" title={row.counterpartyName}>
                            {row.clientName ?? row.counterpartyName}
                          </div>
                          <div className="text-xs tabular-nums text-[var(--color-text-subtle)]">{row.counterpartyTaxId}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-[var(--color-text-muted)]">
                          {formatDateShort(row.issueDate)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <div className="tabular-nums text-[var(--color-text-muted)]">{formatDateShort(row.dueDate)}</div>
                          {due && (
                            <div className={due.tone === "danger" ? "text-xs text-[var(--color-danger-ink)]" : "text-xs text-[var(--color-text-subtle)]"}>
                              {due.label}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                          {row.netAmount === null ? "—" : formatMoney(row.netAmount, row.currency)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                          {row.taxAmount === null ? "—" : formatMoney(row.taxAmount, row.currency)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums font-medium text-[var(--color-text)]">
                          {formatMoney(row.totalAmount, row.currency)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-[var(--color-text)]">
                          {formatMoney(row.outstandingAmount, row.currency)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={payment.tone}>{payment.label}</Badge>
                            {row.collectionStatus !== "none" && (
                              <Badge variant={collection.tone}>{collection.label}</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {row.contractCode ?? "—"}
                          {row.worksiteName && <div className="text-[var(--color-text-subtle)]">{row.worksiteName}</div>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                          {providerLabel(row.source)}
                          <div className="text-[var(--color-text-subtle)]">
                            {row.sourceLastSyncedAt ? formatDateShort(row.sourceLastSyncedAt.slice(0, 10)) : "—"}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {totalPages > 1 && (
            <nav aria-label="Paginación de facturas" className="flex items-center justify-between text-sm">
              <p className="text-[var(--color-text-muted)]">
                Página {result.page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <PageLink params={params} page={result.page - 1} disabled={result.page <= 1}>Anterior</PageLink>
                <PageLink params={params} page={result.page + 1} disabled={result.page >= totalPages}>Siguiente</PageLink>
              </div>
            </nav>
          )}
        </>
      )}

      <p className="text-xs text-[var(--color-text-subtle)]">
        Consulta generada el {formatDateTime(new Date().toISOString())}.
      </p>
    </PageContainer>
  )
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: Record<string, string | undefined>
  page: number
  disabled: boolean
  children: React.ReactNode
}) {
  if (disabled) {
    return <span className="rounded-[var(--radius-md)] px-3 py-1.5 text-[var(--color-text-subtle)]">{children}</span>
  }
  const next = new URLSearchParams(
    Object.entries(params).filter(([, value]) => Boolean(value)) as [string, string][],
  )
  next.set("pagina", String(page))
  return (
    <Link
      href={`/facturacion/facturas?${next.toString()}`}
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
    >
      {children}
    </Link>
  )
}

/* ── Validación de parámetros ────────────────────────────────────────────── */

function matches(value: string | undefined, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined
}

function oneOf<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined
}
