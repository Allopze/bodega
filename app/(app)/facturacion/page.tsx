import type { Metadata } from "next"
import { buttonVariants } from "@/components/ui/button"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ChartLineUp, Warning } from "@phosphor-icons/react/dist/ssr"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { getBillingSummary, listUnlinkedInvoices, todayIso } from "@/lib/services/billing/queries"
import { formatMoney } from "@/lib/services/billing/money"
import {
  formatDateTime,
  formatPeriod,
  providerLabel,
  syncScopeLabel,
  syncStatusLabel,
} from "@/lib/services/billing/labels"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { MoneyStat } from "./money-stat"
import { PeriodPicker } from "@/components/ui/period-picker"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Facturación y cobranza" }

/**
 * Resumen del módulo.
 *
 * Cada cifra sale de una consulta real y declara su período, su moneda y su
 * origen. No hay indicadores decorativos: si un dato no existe todavía, la
 * tarjeta lo dice en vez de mostrar un cero que parece un hecho.
 */
export default async function BillingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!can(session, "billing:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/facturacion")}`)
  }

  const { periodo } = await searchParams
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo ?? "") ? periodo! : todayIso().slice(0, 7)

  const [summary, unlinked] = await Promise.all([
    getBillingSummary(session, { period }),
    can(session, "billing:manage_invoices") ? listUnlinkedInvoices(session, 5) : Promise.resolve([]),
  ])

  const hasData =
    summary.invoiceCount > 0 ||
    summary.outstandingByCurrency.length > 0 ||
    summary.providerStatus.length > 0

  return (
    <PageContainer>
      <PageHeader
        title="Facturación y cobranza"
        description={`Cuentas por cobrar de Chome. Los montos del período corresponden a ${formatPeriod(period)}; el saldo pendiente y el vencido consideran todas las facturas abiertas.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Facturación" },
          ]} />
        }
        actions={<PeriodPicker period={period} />}
      />

      {!hasData ? (
        <EmptyState
          icon={<ChartLineUp size={28} />}
          title="Todavía no hay facturas de venta"
          description="El módulo se alimenta del libro de ventas de FacturaEnLínea. Sincroniza un período desde Sincronización para ver los indicadores con datos reales."
          action={
            can(session, "billing:manage_sync") ? (
              <Link
                href="/facturacion/sincronizacion"
                className={buttonVariants()}
              >
                Ir a Sincronización
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* ── Indicadores principales ─────────────────────────────────── */}
          <section aria-labelledby="kpis-titulo" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <h2 id="kpis-titulo" className="sr-only">Indicadores del período</h2>
            <MoneyStat
              label="Facturado en el período"
              amounts={summary.invoicedByCurrency}
              detail={`${summary.invoiceCount} ${summary.invoiceCount === 1 ? "documento emitido" : "documentos emitidos"} en ${formatPeriod(period)}`}
              origin="Documentos sincronizados desde FacturaEnLínea, sin contar anuladas."
              href={`/facturacion/facturas?periodo=${period}`}
            />
            <MoneyStat
              label="Cobrado del período"
              amounts={summary.collectedByCurrency}
              detail="Solo pagos con confirmación manual"
              origin="Suma de pagos con estado confirmado imputados a facturas emitidas en el período. Una sugerencia de pago no suma acá."
              href={`/facturacion/facturas?periodo=${period}&pago=paid`}
            />
            <MoneyStat
              label="Pendiente de cobro"
              amounts={summary.outstandingByCurrency}
              detail="Saldo de todas las facturas abiertas"
              origin="Total menos pagos confirmados, de todas las facturas no pagadas (no solo del período)."
              href="/facturacion/facturas?pago=unpaid"
            />
            <MoneyStat
              label="Vencido"
              amounts={summary.overdueByCurrency}
              detail={`${summary.overdueCount} ${summary.overdueCount === 1 ? "factura vencida" : "facturas vencidas"} al ${new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" })}`}
              origin="Facturas con fecha de vencimiento anterior a hoy y saldo pendiente."
              tone={summary.overdueCount > 0 ? "danger" : "neutral"}
              href="/facturacion/facturas?vencidas=1"
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Antigüedad de deuda ───────────────────────────────────── */}
            <section
              aria-labelledby="aging-titulo"
              className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
            >
              <header className="mb-3">
                <h2 id="aging-titulo" className="text-sm font-semibold text-[var(--color-text)]">
                  Antigüedad de la deuda
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Saldo pendiente por días transcurridos desde el vencimiento.
                </p>
              </header>
              <TableRoot className="rounded-none border-0 bg-transparent">
                <Table className="text-left">
                  <caption className="sr-only">Antigüedad de facturas por cobrar</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tramo</TableHead>
                      <TableHead className="text-right">Facturas</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {summary.aging.map((bucket) => (
                    <TableRow key={bucket.bucket}>
                      <TableHead scope="row" className="font-normal normal-case tracking-normal">{bucket.label}</TableHead>
                      <TableCell className="text-right tabular-nums text-[var(--color-text-muted)]">{bucket.count}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-[var(--color-text)]">
                        {bucket.byCurrency.length === 0
                          ? "—"
                          : bucket.byCurrency.map((money) => (
                              <div key={money.currency}>{formatMoney(money.amount, money.currency)}</div>
                            ))}
                      </TableCell>
                    </TableRow>
                  ))}
                  </TableBody>
                </Table>
              </TableRoot>
              <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
                Días promedio de pago:{" "}
                <strong className="text-[var(--color-text)]">
                  {summary.averageDaysToPay === null
                    ? "sin facturas pagadas todavía"
                    : `${summary.averageDaysToPay} días`}
                </strong>
                {summary.averageDaysToPay !== null && " entre emisión y último pago confirmado."}
              </p>
            </section>

            {/* ── Estado de las fuentes ─────────────────────────────────── */}
            <section
              aria-labelledby="sync-titulo"
              className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 id="sync-titulo" className="text-sm font-semibold text-[var(--color-text)]">
                    Estado de las fuentes
                  </h2>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Últimas sincronizaciones con los proveedores de facturación.
                  </p>
                </div>
                {can(session, "billing:manage_sync") && (
                  <Link href="/facturacion/sincronizacion" className="text-xs font-medium text-[var(--color-primary-ink)] hover:underline">
                    Ver detalle
                  </Link>
                )}
              </header>
              {summary.providerStatus.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Todavía no se ha ejecutado ninguna sincronización.
                </p>
              ) : (
                <ul className="space-y-2">
                  {summary.providerStatus.map((run, index) => {
                    const status = syncStatusLabel(run.status)
                    return (
                      <li key={`${run.provider}-${run.startedAt}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--color-text)]">
                            {providerLabel(run.provider)} · {syncScopeLabel(run.scope)}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {formatDateTime(run.finishedAt ?? run.startedAt)} · {run.recordsFetched} documentos leídos
                          </p>
                          {run.errorSummary && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-danger-ink)]">{run.errorSummary}</p>
                          )}
                        </div>
                        <Badge variant={status.tone}>{status.label}</Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Principales clientes ──────────────────────────────────── */}
            <RankingSection
              id="clientes"
              title="Principales clientes del período"
              description={`Facturación de ${formatPeriod(period)} atribuida a un cliente mediante un vínculo no descartado.`}
              rows={summary.topClients.map((row) => ({ label: row.clientName, currency: row.currency, amount: row.amount }))}
              emptyMessage="Ninguna factura del período está vinculada todavía a un cliente."
            />

            {/* ── Facturación por faena ─────────────────────────────────── */}
            <RankingSection
              id="faenas"
              title="Facturación por faena"
              description="Solo incluye facturas con faena asignada; el resto queda fuera a propósito."
              rows={summary.byWorksite.map((row) => ({ label: row.worksiteName, currency: row.currency, amount: row.amount }))}
              emptyMessage="Ninguna factura del período tiene faena asignada."
            />
          </div>

          {/* ── Alertas ───────────────────────────────────────────────────── */}
          {unlinked.length > 0 && (
            <section
              aria-labelledby="alertas-titulo"
              className="rounded-[var(--radius-xl)] border border-[var(--color-warning-border,var(--color-border))] bg-[var(--color-warning-tint)] p-4"
            >
              <h2 id="alertas-titulo" className="flex items-center gap-2 text-sm font-semibold text-[var(--color-warning-ink)]">
                <Warning size={16} weight="fill" />
                Facturas sin relación con la operación
              </h2>
              <p className="mt-1 text-xs text-[var(--color-warning-ink)]">
                Se emitieron pero nadie las atribuyó a un cliente, contrato o faena, así que no aparecen en los reportes por faena.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {unlinked.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`/facturacion/facturas/${invoice.id}`} className="text-[var(--color-warning-ink)] underline underline-offset-2">
                      Folio {invoice.folio} · {invoice.receiverName} · {formatMoney(invoice.totalAmount, invoice.currency)}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/facturacion/facturas?sinVinculo=1"
                className="mt-2 inline-block text-xs font-medium text-[var(--color-warning-ink)] underline underline-offset-2"
              >
                Ver todas
              </Link>
            </section>
          )}

          <p className="text-xs text-[var(--color-text-subtle)]">
            Datos actualizados al {formatDateTime(summary.generatedAt)}.
          </p>
        </>
      )}
    </PageContainer>
  )
}

/** Ranking simple por moneda: nunca suma monedas distintas en una sola cifra. */
function RankingSection({
  id,
  title,
  description,
  rows,
  emptyMessage,
}: {
  id: string
  title: string
  description: string
  rows: { label: string; currency: string; amount: number }[]
  emptyMessage: string
}) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
    >
      <header className="mb-3">
        <h2 id={`${id}-titulo`} className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((row, index) => (
            <li key={`${row.label}-${row.currency}-${index}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-[var(--color-text)]">{row.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-[var(--color-text)]">
                {formatMoney(row.amount, row.currency)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
