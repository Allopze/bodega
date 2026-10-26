import type { ComponentProps } from "react"
import { CurrencyDollar, Gauge, ShoppingCart, Timer, Warning } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { RankedList } from "@/components/ui/ranked-list"
import { MoneyStat } from "@/app/(app)/facturacion/money-stat"
import { formatCLP } from "@/lib/utils"
import { getBillingSummary } from "@/lib/services/billing/queries"
import { getPurchasingFinancialSummary } from "@/lib/services/analytics-module/dashboard"
import { getDashboardData } from "@/lib/services/dashboard"
import { getFuelMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getOverdueFuelDebt } from "@/lib/services/dashboard-domains-data"
import { getOperationalCalendarBounds, getOperationalPeriodMetrics } from "@/lib/services/operational-period-metrics"
import { variationPct } from "@/lib/services/analytics-module/helpers"
import { isGlobalRole } from "@/lib/auth/scope"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection, type DomainKpiGroup } from "../dashboard-domain-shell"
import { periodComparisonShortLabel, periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { BillingFlowChart, CompositionDonutChart } from "../dashboard-domain-charts"
import { ChartFrame } from "../charts/chart-frame"
import { DebtAgingChart } from "../charts/debt-aging-chart"
import { ORDERS_ISSUED_METRIC, ORDERS_SPEND_METRIC, ORDERS_SPEND_TREND_POLARITY } from "../dashboard-metric-definitions"
import { analyticsFilters, type DomainSectionsProps } from "./shared"

/**
 * Finanzas: **toda la plata**, en las dos direcciones.
 *
 * Los ingresos (venta) salían sólo en `/facturacion`, que no tenía ninguna
 * presencia en el tablero. Los egresos (gasto en OC, proveedores, combustible,
 * deuda) vivían repartidos entre Adquisiciones y Flota, donde competían con las
 * cifras de proceso de esos dominios. Acá conviven y se comparan.
 *
 * Abre con los gráficos (`chartsFirst`): la pregunta de esta vista es cómo
 * evolucionan la facturación y la deuda, y eso lo responden ellos; los tiles
 * quedan debajo como lectura exacta. Seis tiles en dos grupos rotulados (la
 * excepción declarada a §A1 de AGENTS.md; el resto de las pantallas conserva el
 * tope de 4).
 *
 * «Pendiente de cobro» y «Vencido» ya no son tiles: el titular de «Antigüedad de
 * la deuda» dice el saldo pendiente y lo vencido, y una cifra en dos
 * representaciones es lo que A5 prohíbe (el saldo aparecía tres veces). Lo que
 * tampoco se relaja es A5 entre vistas — por eso el gasto en OC se fue de
 * Adquisiciones al nacer esta sección, en vez de quedar en las dos.
 */

const dominantCurrency = (amounts: ReadonlyArray<{ currency: string; amount: number }>) =>
  amounts.reduce<{ currency: string; amount: number } | null>(
    (top, entry) => (top === null || entry.amount > top.amount ? entry : top), null,
  )?.currency ?? null

const onlyCurrency = (currency: string | null, all: ReadonlyArray<{ currency: string }>) =>
  currency && all.some((entry) => entry.currency !== currency) ? ` · sólo ${currency}` : ""

/** Hay algún monto distinto de cero: una lista con puros ceros no tiene nada que mostrar. */
const hasAmount = (amounts: ReadonlyArray<{ amount: number }>) => amounts.some((entry) => entry.amount > 0)

const amountIn = (amounts: ReadonlyArray<{ currency: string; amount: number }>, currency: string | null) =>
  amounts.find((entry) => entry.currency === currency)?.amount ?? 0

type RankedItems = ComponentProps<typeof RankedList>["items"]

/** Total de un ranking, a la derecha del título: es contra lo que se leen los porcentajes. */
function RankingTotal({ value }: { value: number }) {
  return (
    <span className="text-xs text-[var(--color-text-muted)]">
      Total <strong className="font-semibold tabular-nums text-[var(--color-text)]">{formatCLP(value)}</strong>
    </span>
  )
}

export async function FinanceSection({ session, scope }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)
  const worksiteId = scopedWorksiteId(scope)
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)

  /*
   * La facturación de venta sigue el **mismo alcance** que el resto del
   * tablero: faena y ventana de fechas.
   *
   * `getBillingSummary` toma `[from, to)` en claves de fecha, que es
   * exactamente lo que `getOperationalCalendarBounds` entrega (`currentEnd` es
   * exclusivo). `period` queda como el período tributario ancla —el mes de
   * inicio de la ventana— y sólo rotula.
   */
  const billingPeriod = bounds.currentStart.slice(0, 7)
  const billingWindow = {
    from: bounds.currentStart.slice(0, 10),
    to: bounds.currentEnd.slice(0, 10),
  }
  /** Con el mes elegido, la ventana ES el período tributario: el enlace acota. */
  const invoiceListHref = (extra = "") =>
    scope.period === "mes"
      ? `/facturacion/facturas?periodo=${billingPeriod}${extra}`
      : `/facturacion/facturas${extra ? `?${extra.replace(/^&/, "")}` : ""}`
  const canSeeFuelCosts = has("combustibles:view") && has("combustibles:view_costs")
  const canSeeFuelDebt = canSeeFuelCosts && isGlobalRole(session)
  const canSeePurchasing = has("purchasing:view")
  const analyticsScope = analyticsFilters(scope)

  const [billing, analytics, periodMetrics, fuelTrend, debt, dashboardData] = await Promise.all([
    has("billing:view")
      ? getBillingSummary(session, { period: billingPeriod, ...billingWindow, ...(worksiteId ? { worksiteId } : {}) }).catch(() => null)
      : Promise.resolve(null),
    canSeePurchasing
      ? getPurchasingFinancialSummary(session, analyticsScope)
      : Promise.resolve(null),
    // INI-01: el conteo y el monto de OC salen de la **misma** función que el
    // Resumen y Adquisiciones (`getOperationalPeriodMetrics`); el resumen
    // financiero queda para los desgloses (por módulo y por proveedor).
    canSeePurchasing ? getOperationalPeriodMetrics(session, { period: scope.period, ...(worksiteId ? { worksiteId } : {}) }) : Promise.resolve(null),
    canSeeFuelCosts ? getFuelMonthlyTrend(session, 6, worksiteId) : Promise.resolve([]),
    canSeeFuelDebt ? getOverdueFuelDebt(bounds.currentEnd.slice(0, 10)) : Promise.resolve({ amount: 0, statements: 0 }),
    canSeePurchasing ? getDashboardData(session, worksiteId).catch(() => null) : Promise.resolve(null),
  ])

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")
  const fuelCost = fuelTrend.reduce((sum, point) => sum + (point.amount ?? 0), 0)

  /*
   * Los gráficos de ranking dibujan **una sola moneda**.
   *
   * `MoneyStat` sabe apilar una línea por moneda sin sumarlas nunca, pero una
   * barra en un eje común no: 1.000 USD junto a 900.000 CLP se leería como una
   * barra 900 veces más corta, y con `format="clp"` además llevaría signo de
   * peso. Hoy no puede pasar —el único proveedor fija `currency: "CLP"`
   * (`providers/factura-en-linea.ts`)— pero el esquema admite cualquier
   * ISO-4217, así que el gráfico se acota por construcción y no por suerte.
   *
   * Se elige la moneda de mayor monto y se declara cuando hay más de una: el
   * resto no se esconde en silencio.
   */

  const debtCurrency = billing ? dominantCurrency(billing.outstandingByCurrency) : null
  const salesCurrency = billing ? dominantCurrency(billing.invoicedByCurrency) : null
  const debtInSeveralCurrencies = billing ? billing.outstandingByCurrency.some((entry) => entry.currency !== debtCurrency) : false
  /** Coletilla que declara el recorte, sólo cuando hay algo que recortar. */

  /*
   * Una cifra de esta sección no puede respetar el filtro de faena y hay que
   * decirlo: la cuenta corriente de combustible es por proveedor.
   *
   * La nota gemela de DTE ya no existe: calificaba cifras que esta sección
   * nunca mostró (auditoría 2026-08-19, REC-08/API-05).
   */
  const notes = [
    canSeeFuelDebt && debt.statements > 0 && worksiteId
      ? "La deuda de cuenta corriente es por proveedor: no se puede repartir por faena."
      : null,
  ].filter(Boolean)

  /** "en el mes en curso", "en el trimestre en curso", "en el año en curso". */
  const enPeriodo = `en el ${periodo}`
  const kpiGroups: DomainKpiGroup[] = []

  if (billing) {
    /*
     * Un tile sin cifra dice qué hacer (A1), pero la acción tiene que existir:
     * las facturas se emiten en FacturaEnLínea, no acá, así que «Emitir factura»
     * sólo se ofrece a quien puede preparar propuestas y lleva a «Pendientes de
     * facturar», que es donde empieza el cobro. Quien sólo ve recibe el verbo
     * que sí puede cumplir.
     *
     * «Cobrado» en cero con facturas emitidas también es un tile vacío: la
     * lista de pagos del período no tiene nada, y el destino útil es la cobranza.
     * (La deuda vencida en $0, en cambio, es buena noticia y conserva su cifra.)
     */
    const noInvoices = !hasAmount(billing.invoicedByCurrency)
    const noPayments = !hasAmount(billing.collectedByCurrency)
    kpiGroups.push({
      key: "ingresos",
      label: "Ingresos (facturación de venta)",
      content: (
        <>
          <MoneyStat surface="flat" label="Facturado en el período" amounts={noInvoices ? [] : billing.invoicedByCurrency}
            detail={`${billing.invoiceCount} ${billing.invoiceCount === 1 ? "documento emitido" : "documentos emitidos"} · ${periodo}`}
            origin="Documentos sincronizados desde FacturaEnLínea, sin contar anuladas."
            href={noInvoices ? "/facturacion/pendientes" : invoiceListHref()}
            emptyAction={{
              message: `Sin facturas emitidas ${enPeriodo}`,
              label: has("billing:create_proposal") ? "Emitir factura" : "Ver pendientes de facturar",
            }} />
          <MoneyStat surface="flat" label="Cobrado del período" amounts={noPayments ? [] : billing.collectedByCurrency}
            detail="Sólo pagos con confirmación manual"
            origin="Suma de pagos confirmados imputados a facturas emitidas en el período. Una sugerencia de pago no suma acá."
            href={noPayments ? "/facturacion/cobranza" : invoiceListHref("&pago=paid")}
            emptyAction={{
              message: "Sin pagos confirmados",
              label: has("billing:confirm_payments") ? "Registrar un pago" : "Ver cobranza",
            }} />
        </>
      ),
    })
  }

  if (analytics || canSeeFuelCosts) {
    // Con cero OC en el período el gasto y el ticket medio no son "$0": no hay
    // nada que sumar ni promediar. Cada tile lo dice y, si el rol puede, ofrece
    // emitir la primera.
    const noOrders = periodMetrics !== null && periodMetrics.ordersIssued.current === 0
    const canCreateOrder = has("purchasing:create_order")
    kpiGroups.push({
      key: "egresos",
      label: "Egresos (compra y consumo)",
      content: (
        <>
          {periodMetrics && (
            <KpiCard {...DASHBOARD_KPI} icon={<ShoppingCart size={16} />} label={ORDERS_SPEND_METRIC.label} value={formatCLP(periodMetrics.spend.current)}
              detail={noOrders ? "" : `${periodMetrics.ordersIssued.current} ${ORDERS_ISSUED_METRIC.label} · ${periodo}`}
              glossary={ORDERS_SPEND_METRIC.glossary}
              // Un gasto que baja es buena noticia: sin `up-bad` el tile pintaba
              // la baja en rojo (INI-01, auditoría 2026-10-05).
              trend={noOrders || periodMetrics.spend.previous === null ? null : variationPct(periodMetrics.spend.current, periodMetrics.spend.previous)}
              trendPolarity={ORDERS_SPEND_TREND_POLARITY}
              trendLabel={periodComparisonShortLabel(scope.period)}
              href={noOrders && canCreateOrder ? `/compras/nueva${worksiteId ? `?faena=${worksiteId}` : ""}` : "/compras"}
              empty={noOrders ? { message: `Sin OC emitidas ${enPeriodo}`, ...(canCreateOrder ? { actionLabel: "Emitir una OC" } : {}) } : undefined} />
          )}
          {analytics && (
            <KpiCard {...DASHBOARD_KPI} icon={<Timer size={16} />} label="Ticket medio por OC" value={formatCLP(analytics.kpis.averageOrderAmount)}
              detail={analytics.kpis.purchaseOrderCount === 0 ? `Aparece con la primera OC del ${periodo}` : `Monto promedio · ${periodo}`}
              href={has("analytics:view") ? "/analitica" : "/compras"}
              empty={analytics.kpis.purchaseOrderCount === 0 ? { message: "Sin OC para promediar" } : undefined} />
          )}
          {canSeeFuelCosts && (
            // La ventana de este tile son los últimos 6 meses, no el período del
            // tablero: el mensaje la nombra para no prometer "este mes".
            <KpiCard {...DASHBOARD_KPI} icon={<Gauge size={16} />} label="Costo de combustible" value={formatCLP(fuelCost)}
              detail="Cargas facturadas · últimos 6 meses" href="/combustibles"
              empty={fuelCost === 0 ? { message: "Sin cargas facturadas en 6 meses", actionLabel: "Ver cargas" } : undefined} />
          )}
          {canSeeFuelDebt && (
            <KpiCard {...DASHBOARD_KPI} icon={<Warning size={16} />} label="Deuda vencida" value={formatCLP(debt.amount)}
              detail={debt.statements > 0 ? `${debt.statements} cuenta(s) · hoy` : "Sin cuentas vencidas, hoy"}
              tone={debt.amount > 0 ? "signal" : "neutral"} href="/combustibles/cuenta-corriente" />
          )}
        </>
      ),
    })
  }

  // Sin ninguna de las dos mitades el rol no debería ver la pestaña, pero el
  // permiso puede autorizar la sección y la consulta fallar: mejor un tile de
  // contexto que una sección con dos filas vacías.
  if (kpiGroups.length === 0) {
    kpiGroups.push({
      key: "sin-datos",
      label: null,
      content: (
        <KpiCard {...DASHBOARD_KPI} icon={<CurrencyDollar size={16} />} label="Facturación" value="Sin datos"
          detail={has("billing:manage_sync") ? "Sincroniza un período para ver los indicadores" : "No hay indicadores disponibles para el período"}
          href={has("billing:manage_sync") ? "/facturacion/sincronizacion" : has("billing:view") ? "/facturacion" : undefined} />
      ),
    })
  }

  /*
   * Rankings: lista con barra de fondo en un solo tono, en vez de un gráfico de
   * barras con un color por barra (el color no codificaba nada). Cada bloque
   * conserva su guarda de datos: sin filas devuelve `null` y el `ChartSlot` se
   * oculta, así que no queda un hueco en el bento.
   */
  const supplierRows = analytics?.topSuppliers.slice(0, 8) ?? []
  // El servicio entrega los 10 mayores y acá se muestran 8; el resto, junto con
  // lo que el límite de la consulta dejó fuera, se agrupa en «Otros». Sin esa
  // fila el % de cada proveedor se calculaba contra la suma de los visibles y
  // sobreestimaba su peso: el 100 % de la lista no era el 100 % del gasto.
  const otherSpend = analytics
    ? Math.max(0, analytics.kpis.totalSpend - supplierRows.reduce((sum, row) => sum + row.totalAmount, 0))
    : 0
  const supplierItems: RankedItems = [
    ...supplierRows.map((row) => ({
      key: row.id,
      label: row.name,
      value: Math.round(row.totalAmount),
      detail: `${row.count} OC`,
      // `analyticsScope.toDate` es inclusivo, que es lo que lee `/compras`: la
      // lista reproduce exactamente el período que suma el ranking.
      href: `/compras?${new URLSearchParams({
        desde: analyticsScope.fromDate,
        hasta: analyticsScope.toDate,
        ...(worksiteId ? { faena: worksiteId } : {}),
        proveedor: row.id,
      })}`,
    })),
    ...(otherSpend >= 1 ? [{ key: "otros", label: "Otros proveedores", value: Math.round(otherSpend) }] : []),
  ]

  const clientItems: RankedItems = billing && salesCurrency
    ? billing.topClients
      .filter((row) => row.currency === salesCurrency)
      .slice(0, 8)
      // Sin `clientId` en el resumen no hay filtro de facturas al que enlazar.
      .map((row, index) => ({ key: `${index}-${row.clientName}`, label: row.clientName, value: Math.round(row.amount) }))
    : []

  const WORKSITE_LIMIT = 10
  const worksiteItems: RankedItems = (dashboardData?.worksitesBreakdown ?? [])
    .filter((row) => row.totalCost > 0)
    .map((row) => ({ key: row.id, label: row.name, value: Math.round(row.totalCost), href: `/compras?faena=${row.id}` }))

  const sumOf = (items: RankedItems) => items.reduce((sum, item) => sum + item.value, 0)

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.finanzas}
      chartsFirst
      note={notes.length > 0 ? notes.join(" ") : undefined}
      links={[
        ...(has("billing:view") ? [{ label: "Facturación", href: "/facturacion" }] : []),
        ...(canSeePurchasing ? [{ label: "Compras", href: "/compras" }] : []),
        ...(has("analytics:view") ? [{ label: "Analítica", href: "/analitica" }] : []),
      ]}
      kpiGroups={kpiGroups}
      charts={
        <>
          {billing && billing.monthly.length > 0 && (
            <ChartSlot span="wide">
              <BillingFlowChart data={billing.monthly.map((row) => ({
                period: row.period, invoiced: row.invoiced, collected: row.collected,
              }))} />
            </ChartSlot>
          )}
          {billing && (
            // Se dibuja también sin deuda: con los tiles «Pendiente de cobro» y
            // «Vencido» fuera, este es el único lugar donde dice «Sin saldo
            // pendiente». Los tramos van en el orden de `AGING_BUCKETS`.
            <ChartSlot>
              <DebtAgingChart
                description={`Saldo pendiente por días desde el vencimiento${onlyCurrency(debtCurrency, billing.outstandingByCurrency)}`}
                currency={debtCurrency ?? "CLP"}
                totalAmount={amountIn(billing.outstandingByCurrency, debtCurrency)}
                overdueAmount={amountIn(billing.overdueByCurrency, debtCurrency)}
                buckets={billing.aging.map((bucket) => ({
                  key: bucket.bucket,
                  label: bucket.label,
                  amount: amountIn(bucket.byCurrency, debtCurrency),
                  // El conteo del servicio suma todas las monedas: con más de una,
                  // un "N facturas" junto a un monto en una sola sería de otro conjunto.
                  count: debtInSeveralCurrencies ? null : bucket.count,
                }))}
                // Cobranza agrupa lo abierto por lo que corresponde hacer; la
                // lista de facturas filtra las vencidas. No hay filtro por
                // tramo, así que las filas no enlazan.
                openHref="/facturacion/cobranza"
                overdueHref="/facturacion/facturas?vencidas=1"
              />
            </ChartSlot>
          )}
          {analytics && (
            <ChartSlot>
              <CompositionDonutChart
                title="Gasto por módulo" description={`De qué se compone el gasto en ${periodo}`}
                totalLabel="del período" format="clp"
                data={analytics.spendByModule.map((row) => ({ key: row.module, label: row.module, value: row.totalAmount }))}
              />
            </ChartSlot>
          )}
          {supplierItems.length > 0 && (
            <ChartSlot>
              <ChartFrame title="Proveedores por gasto" description="Concentración de compra en el período" aside={<RankingTotal value={sumOf(supplierItems)} />}>
                <RankedList items={supplierItems} format="clp" mode="share" order="input" limit={supplierItems.length} ariaLabel="Proveedores por gasto" />
              </ChartFrame>
            </ChartSlot>
          )}
          {billing && salesCurrency && clientItems.length > 0 && (
            <ChartSlot>
              <ChartFrame
                title="Principales clientes"
                description={`Facturación del período atribuida a un cliente${onlyCurrency(salesCurrency, billing.invoicedByCurrency)}`}
                aside={<RankingTotal value={sumOf(clientItems)} />}
              >
                <RankedList items={clientItems} format="clp" mode="share" limit={clientItems.length} ariaLabel="Principales clientes" />
              </ChartFrame>
            </ChartSlot>
          )}
          {worksiteItems.length > 0 && (
            /* Ancho completo: cerraba la grilla solo en su fila (I-09) y un
               ranking de faenas gana con rótulos más largos. */
            <ChartSlot span="full">
              <ChartFrame
                title="Inversión por faena"
                description={`Monto comprometido por centro de costos · acumulado histórico${worksiteItems.length > WORKSITE_LIMIT ? ` · ${WORKSITE_LIMIT} principales de ${worksiteItems.length}` : ""}`}
                aside={<RankingTotal value={sumOf(worksiteItems)} />}
              >
                <RankedList items={worksiteItems} format="clp" mode="share" limit={WORKSITE_LIMIT} ariaLabel="Inversión por faena" />
              </ChartFrame>
            </ChartSlot>
          )}
        </>
      }
    />
  )
}
