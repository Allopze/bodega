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
  agingBucketsFor,
  agingCurrencies,
  agingInsight,
  agingTable,
  billingPeriodLabel,
  changesByCurrency,
  flowInsight,
  flowSeriesByCurrency,
  flowTable,
  previousPeriod,
  rankingByCurrency,
  type RankingGroup,
} from "@/lib/services/billing/summary-charts"
import { formatDate, todayInChile } from "@/lib/utils"
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
import { MetaBadge } from "@/components/states/state-badge"
import { MoneyStat } from "./money-stat"
import { BillingFlowChartLazy } from "./billing-flow-lazy"
import { PeriodPicker } from "@/components/ui/period-picker"
import { RankedList } from "@/components/ui/ranked-list"
import { ChartSection } from "@/components/charts/chart-section"
import { DebtAgingChart } from "@/components/charts/debt-aging-chart"

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

  /*
   * Lo mensual que `getBillingSummary` ya consultaba (`summary.monthly`) y la
   * página no dibujaba. Una serie y un gráfico por moneda: nunca se suman CLP y
   * USD. El mes en curso no ha terminado, así que se marca como parcial.
   */
  const flowSeries = flowSeriesByCurrency(summary.monthly, period)
  const partialPeriod = period === todayIso().slice(0, 7) ? period : undefined
  const canSync = can(session, "billing:manage_sync")

  // «Facturado» se compara con el mismo mes anterior. «Cobrado» no: sus cifras
  // son por mes de emisión y el mes anterior ha tenido un mes más para cobrarse,
  // así que la comparación sesgaría siempre a la baja.
  const previousLabel = `vs. ${billingPeriodLabel(previousPeriod(period)).split(" ")[0]!.toLowerCase()}`
  const invoicedComparison = {
    label: previousLabel,
    changes: changesByCurrency(summary.monthly, period, "invoiced", summary.invoicedByCurrency),
  }

  // El conteo de facturas del servicio suma todas las monedas: con más de una no se muestra.
  const { charted: agingCharted, singleCurrency: agingWithCounts } = agingCurrencies(summary.aging)
  const clientGroups = rankingByCurrency(
    summary.topClients.map((row) => ({ label: row.clientName, currency: row.currency, amount: row.amount })),
    summary.invoicedByCurrency,
  )
  const worksiteGroups = rankingByCurrency(
    summary.byWorksite.map((row) => ({ label: row.worksiteName, currency: row.currency, amount: row.amount })),
    summary.invoicedByCurrency,
  )

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
              comparison={invoicedComparison}
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
              detail={`${summary.overdueCount} ${summary.overdueCount === 1 ? "factura vencida" : "facturas vencidas"} al ${formatDate(todayInChile())}`}
              origin="Facturas con fecha de vencimiento anterior a hoy y saldo pendiente."
              tone={summary.overdueCount > 0 ? "danger" : "neutral"}
              href="/facturacion/facturas?vencidas=1"
            />
          </section>

          {/* ── Facturado y cobrado · antigüedad de la deuda ────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            {flowSeries.length === 0 ? (
              <ChartSection
                title="Facturado y cobrado"
                empty={{
                  label: "Sin facturación en los últimos 12 meses",
                  hint: "Cuando se sincronice el libro de ventas, acá se ve mes a mes lo facturado contra lo cobrado.",
                  ...(canSync ? { ctaLabel: "Ir a Sincronización", ctaHref: "/facturacion/sincronizacion" } : {}),
                }}
              />
            ) : (
              flowSeries.map((series) => (
                <ChartSection
                  key={series.currency}
                  title={flowSeries.length > 1 ? `Facturado y cobrado · ${series.currency}` : "Facturado y cobrado"}
                  summary={flowInsight(series, partialPeriod)}
                  data={flowTable(series)}
                >
                  <BillingFlowChartLazy data={series.rows} currency={series.currency} variant="plain" partialPeriod={partialPeriod} />
                  <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
                    Cobrado: pagos confirmados de las facturas emitidas en cada mes; los meses recientes todavía pueden subir.
                  </p>
                </ChartSection>
              ))
            )}

            {agingCharted.length === 0 ? (
              <ChartSection
                title="Antigüedad de la deuda"
                empty={{
                  label: "Sin saldo pendiente",
                  hint: "No hay facturas por cobrar. Cuando haya una abierta, se reparte acá según los días que lleva vencida.",
                  ctaLabel: "Ver facturas",
                  ctaHref: "/facturacion/facturas",
                }}
              />
            ) : (
              agingCharted.map((currency, index) => {
                const buckets = agingBucketsFor(summary.aging, currency, agingWithCounts)
                const outstanding = buckets.reduce((sum, bucket) => sum + bucket.amount, 0)
                return (
                  <ChartSection
                    key={currency}
                    title={agingCharted.length > 1 ? `Antigüedad de la deuda · ${currency}` : "Antigüedad de la deuda"}
                    summary={agingInsight(buckets, currency)}
                    data={agingTable(summary.aging, { currency, withCounts: agingWithCounts })}
                    drillHref="/facturacion/cobranza"
                    drillLabel="Ir a Cobranza"
                  >
                    {/* Los tramos van en el orden de los días y no enlazan: la lista de facturas
                        filtra «vencidas» (el tile), pero no por tramo, y un enlace que no
                        reproduce el tramo diría otra cifra. */}
                    <DebtAgingChart
                      variant="plain"
                      currency={currency}
                      buckets={buckets}
                      totalAmount={outstanding}
                      overdueAmount={summary.overdueByCurrency.find((money) => money.currency === currency)?.amount ?? 0}
                    />
                    {index === 0 && (
                      <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
                        Días promedio de pago:{" "}
                        <strong className="text-[var(--color-text)]">
                          {summary.averageDaysToPay === null
                            ? "sin facturas pagadas todavía"
                            : `${summary.averageDaysToPay} días`}
                        </strong>
                        {summary.averageDaysToPay !== null && " entre emisión y último pago confirmado."}
                      </p>
                    )}
                  </ChartSection>
                )
              })
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {/* ── Principales clientes ──────────────────────────────────── */}
            <RankingSection
              id="clientes"
              title="Principales clientes del período"
              description={`Facturación de ${formatPeriod(period)} atribuida a un cliente mediante un vínculo no descartado.`}
              groups={clientGroups}
              emptyMessage="Ninguna factura del período está vinculada todavía a un cliente."
            />

            {/* ── Facturación por faena ─────────────────────────────────── */}
            <RankingSection
              id="faenas"
              title="Facturación por faena"
              description="Solo incluye facturas con faena asignada; el resto queda fuera a propósito."
              groups={worksiteGroups}
              emptyMessage="Ninguna factura del período tiene faena asignada."
            />

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
                            <p className="mt-0.5 text-xs text-[var(--color-danger-ink)]">
                              La sincronización reportó errores. {can(session, "billing:manage_sync")
                                ? "Revisa el detalle de sincronización."
                                : "Solicita una revisión a quien administra las sincronizaciones."}
                            </p>
                          )}
                        </div>
                        <MetaBadge meta={status} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
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
              <ul className="mt-2 space-y-2 text-sm">
                {unlinked.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      href={`/facturacion/facturas/${invoice.id}`}
                      className="flex min-h-8 items-center rounded px-2 py-1 text-[var(--color-warning-ink)] underline underline-offset-2 hover:bg-[var(--color-warning-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                    >
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

/**
 * Ranking por moneda: una `RankedList` por cada una, nunca una barra común.
 * Con una sola moneda (lo normal) no se rotula; con varias, cada lista lleva su
 * código. En otra moneda que no es CLP la cifra va sin signo de peso.
 */
function RankingSection({
  id,
  title,
  description,
  groups,
  emptyMessage,
}: {
  id: string
  title: string
  description: string
  groups: RankingGroup[]
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
      {groups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.currency}>
              {groups.length > 1 && (
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{group.currency}</h3>
              )}
              <RankedList
                items={group.items}
                format={group.currency === "CLP" ? "clp" : "count"}
                unit={group.currency === "CLP" ? undefined : ` ${group.currency}`}
                mode="share"
                order="input"
                limit={group.items.length}
                showShare={false}
                ariaLabel={groups.length > 1 ? `${title} en ${group.currency}` : title}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
