import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, purchaseOrders,
  receipts, worksites,
} from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { pendingPurchaseWhere } from "@/lib/adquisiciones/pending-purchase"
import { issuedOrderPredicate } from "@/lib/services/operational-period-metrics"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList } from "@/components/ui/ranked-list"
import { ChartSection } from "@/components/charts/chart-section"
import { GroupedBarList } from "@/components/charts/grouped-bar-list"
import { CHART_SERIES } from "@/lib/chart-palette"
import { formatCLP, formatQty } from "@/lib/utils"
import { and, asc, count, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm"
import { ClipboardText, ShoppingCart, Truck } from "@phosphor-icons/react/dist/ssr"
import { periodComparisonShortLabel, periodScopeLabel } from "../dashboard/dashboard-scope"
import { spendVariationPct } from "../dashboard/dashboard-metric-definitions"
import {
  backlogSummary, buildWorksiteBacklog, statusItems, statusRows, statusSummary, worksiteLabels,
} from "./reportes-page.helpers"
import { listWindowParams, parseReportPeriod, reportWindows, type ReportWindow } from "./reportes-period"
import { ReportsScopeControls } from "./reports-scope-controls"
import { ReportsExportMenu } from "./reports-export-menu"

export const metadata: Metadata = { title: "Reportes" }

/** Serie de cada barra del gráfico de pendientes: las dos primeras categorías de la paleta, vecinas y distintas. */
const BACKLOG_SERIES = [
  { key: "withoutOrder", label: "Ítems sin OC", color: CHART_SERIES[0] },
  { key: "pendingReceipt", label: "OC por recibir", color: CHART_SERIES[1] },
]

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/** `count(*) filter (where …)`: un conteo de una ventana dentro de una consulta que mira dos. */
const countWhere = (condition: SQL | undefined) => sql<number>`count(*) filter (where ${condition ?? sql`true`})`

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("reports:view") }
  catch { redirect("/forbidden") }

  const params = await searchParams
  const period = parseReportPeriod(params.periodo)
  const { current, previous } = reportWindows(period)

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const scope: string[] | "all" = isGlobal ? "all" : wsIds

  // Todas las faenas, también las inactivas: los desgloses cuentan OC e ítems
  // históricos, y una faena dada de baja salía como su UUID. El selector de
  // faena y el de exportación sólo ofrecen las activas **dentro del alcance**.
  const allWorksites = await db
    .select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
    .from(worksites)
    .orderBy(asc(worksites.name))
  const activeWorksites = allWorksites
    .filter((worksite) => worksite.isActive)
    .map(({ id, name }) => ({ id, name }))
  const selectableWorksites = scope === "all" ? activeWorksites : activeWorksites.filter((worksite) => scope.includes(worksite.id))
  // Una faena en la URL que el usuario no puede ver no amplía ni cambia nada: se ignora (el alcance es el techo).
  const worksiteId = selectableWorksites.find((worksite) => worksite.id === firstParam(params.faena))?.id

  // La faena elegida se INTERSECTA con el alcance del rol (`worksiteScopeSqlFor`): nunca lo reemplaza.
  const requestWsFilter = worksiteScopeSqlFor(scope, purchaseRequests.worksiteId, worksiteId)
  // DAT-16: una OC eliminada (soft-delete, deletedAt poblado) no debe seguir sumando.
  const orderWsFilter = and(isNull(purchaseOrders.deletedAt), worksiteScopeSqlFor(scope, purchaseOrders.worksiteId, worksiteId))
  // Un usuario scoped solo ve recepciones de sus faenas — nunca las de worksiteId NULL (B-6).
  // Una recepción anulada (`voided`) no es una recepción registrada: Fase 0 · 0.3.
  const receiptWsFilter = and(ne(receipts.status, "voided"), worksiteScopeSqlFor(scope, receipts.worksiteId, worksiteId))

  const inWindow = (column: Parameters<typeof gte>[0], window: ReportWindow | null, key = false) =>
    window ? and(gte(column, key ? window.startKey : window.start), lt(column, key ? window.endKey : window.end)) : undefined
  /** Lo que mira una consulta con dos ventanas: la unión de las dos (o todo, con «Todo»). */
  const eitherWindow = (column: Parameters<typeof gte>[0], key = false) =>
    current && previous ? or(inWindow(column, current, key), inWindow(column, previous, key)) : undefined
  const currentOnly = (column: Parameters<typeof gte>[0], key = false) => inWindow(column, current, key)

  const [
    requestRows,
    itemStatusRows,
    orderStatusRows,
    [orderSummary],
    [receiptSummary],
    itemsSinOcByWorksite,
    ocPendingByWorksite,
  ] = await Promise.all([
    // Solicitudes creadas en el período, por estado, y en el anterior (para la variación).
    db
      .select({
        status: purchaseRequests.status,
        total: countWhere(currentOnly(purchaseRequests.createdAt)),
        previous: countWhere(previous ? inWindow(purchaseRequests.createdAt, previous) : sql`false`),
      })
      .from(purchaseRequests)
      .where(and(requestWsFilter, eitherWindow(purchaseRequests.createdAt)))
      .groupBy(purchaseRequests.status),

    // Ítems de las solicitudes creadas en el período, por estado.
    db
      .select({ status: purchaseRequestItems.status, total: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eqRequestItemRequest())
      .where(and(requestWsFilter, currentOnly(purchaseRequests.createdAt)))
      .groupBy(purchaseRequestItems.status),

    // OC creadas en el período, por estado: el ciclo completo, también borradores y anuladas.
    db
      .select({ status: purchaseOrders.status, total: count() })
      .from(purchaseOrders)
      .where(and(orderWsFilter, currentOnly(purchaseOrders.createdAt)))
      .groupBy(purchaseOrders.status),

    // OC EMITIDAS en el período, con la definición y la fecha del tablero (`issuedOrderPredicate` + `issuedAt`).
    db
      .select({
        total: countWhere(currentOnly(purchaseOrders.issuedAt, true)),
        totalAmount: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}) filter (where ${currentOnly(purchaseOrders.issuedAt, true) ?? sql`true`}), 0)`,
        previous: countWhere(previous ? inWindow(purchaseOrders.issuedAt, previous, true) : sql`false`),
      })
      .from(purchaseOrders)
      .where(and(orderWsFilter, issuedOrderPredicate(), eitherWindow(purchaseOrders.issuedAt, true))),

    db
      .select({
        total: countWhere(currentOnly(receipts.receivedAt)),
        previous: countWhere(previous ? inWindow(receipts.receivedAt, previous) : sql`false`),
      })
      .from(receipts)
      .where(and(receiptWsFilter, eitherWindow(receipts.receivedAt))),

    // Lo pendiente es la FOTO DE HOY, no una cohorte del período: un ítem pedido hace tres meses que
    // sigue sin OC es justo lo que esta pantalla debe mostrar.
    db
      .select({ worksiteId: purchaseRequests.worksiteId, total: count() })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eqRequestItemRequest())
      // "Ítems sin OC por faena" es la misma pregunta que responde la cola de
      // Compras, así que usa su predicado.
      .where(pendingPurchaseWhere(requestWsFilter))
      .groupBy(purchaseRequests.worksiteId),

    db
      .select({ worksiteId: purchaseOrders.worksiteId, total: count() })
      .from(purchaseOrders)
      .where(and(orderWsFilter, inArray(purchaseOrders.status, ["sent", "partially_office_received", "office_received", "partially_received"])))
      .groupBy(purchaseOrders.worksiteId),
  ])

  const requestTotal = requestRows.reduce((total, row) => total + Number(row.total), 0)
  const requestPrevious = requestRows.reduce((total, row) => total + Number(row.previous), 0)
  const ordersIssued = Number(orderSummary?.total ?? 0)
  const receiptsTotal = Number(receiptSummary?.total ?? 0)

  const periodLabel = current ? periodScopeLabel(period as "mes" | "trimestre" | "anio").toLocaleLowerCase("es-CL") : "todo el historial"
  const inPeriod = current ? `En el ${periodLabel}` : "En todo el historial"
  const comparison = current ? periodComparisonShortLabel(period as "mes" | "trimestre" | "anio") : undefined
  /** Variación contra el período anterior; `null` (sin tile de variación) con «Todo» o con un período previo en cero. */
  const variation = (now: number, before: number) => (previous ? spendVariationPct(now, before) : null)
  const listParams = (extra: Record<string, string> = {}) => new URLSearchParams({ ...listWindowParams(current, worksiteId), ...extra }).toString()
  const withQuery = (path: string, query: string) => (query ? `${path}?${query}` : path)

  const metrics = [
    {
      label: "Solicitudes creadas",
      icon: <ClipboardText size={16} />,
      value: formatQty(requestTotal),
      detail: inPeriod,
      trend: variation(requestTotal, requestPrevious),
      href: withQuery("/solicitudes", listParams()),
    },
    {
      label: "OC emitidas",
      icon: <ShoppingCart size={16} />,
      value: formatQty(ordersIssued),
      detail: `${formatCLP(Number(orderSummary?.totalAmount ?? 0))} con IVA`,
      trend: variation(ordersIssued, Number(orderSummary?.previous ?? 0)),
      href: withQuery("/compras", listParams()),
    },
    {
      label: "Recepciones registradas",
      icon: <Truck size={16} />,
      value: formatQty(receiptsTotal),
      detail: "Sin contar anuladas",
      trend: variation(receiptsTotal, Number(receiptSummary?.previous ?? 0)),
      href: "/recepcion",
    },
  ]

  const requestStatuses = statusRows(requestRows.map((row) => ({ status: row.status, total: Number(row.total) })), "request")
  const requestItems = statusItems(requestStatuses, "request", (status) => withQuery("/solicitudes", listParams({ estado: status })))
  const itemItems = statusItems(statusRows(itemStatusRows, "item"), "item")
  const orderItems = statusItems(statusRows(orderStatusRows, "oc"), "oc")

  const backlog = buildWorksiteBacklog(itemsSinOcByWorksite, ocPendingByWorksite, worksiteLabels(allWorksites))
  const itemsSinOcTotal = backlog.reduce((total, row) => total + row.withoutOrder, 0)
  const ocPendingTotal = backlog.reduce((total, row) => total + row.pendingReceipt, 0)


  return (
    <PageContainer>
      <PageHeader
        title="Reportes"
        description="Resumen operativo desde datos persistidos."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Reportes" },
          ]} />
        }
        actions={<ReportsExportMenu worksites={activeWorksites} />}
      />

      <div className="grid grid-cols-1 gap-5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <ReportsScopeControls period={period} worksiteId={worksiteId} worksites={selectableWorksites} />
          <p className="max-w-prose text-xs leading-5 text-[var(--color-text-muted)] text-pretty">
            Período: <strong className="font-semibold text-[var(--color-text)]">{periodLabel}</strong>. Las solicitudes, los ítems y las OC por estado son los creados en el período; las OC emitidas, por su fecha de emisión (como en el tablero). Lo pendiente por faena es la foto de hoy.
          </p>
        </div>

        <section aria-label="Resumen del período" className="grid gap-3 md:grid-cols-3">
          {metrics.map((metric) => (
            <KpiCard
              key={metric.label}
              icon={metric.icon}
              label={metric.label}
              value={metric.value}
              detail={metric.detail}
              trend={metric.trend}
              // Un volumen de trabajo que sube no es ni bueno ni malo por sí solo.
              trendPolarity="neutral"
              trendLabel={comparison}
              href={metric.href}
            />
          ))}
        </section>

        <section aria-label="Estados por ciclo de vida" className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <ChartSection
            title="Solicitudes por estado"
            summary={statusSummary(requestItems, { singular: "solicitud", plural: "solicitudes" })}
            empty={requestItems.length === 0 ? { label: "Sin solicitudes en el período", hint: "Cambia el período o la faena para ver otras." } : null}
          >
            <RankedList items={requestItems} format="count" mode="share" order="input" limit={requestItems.length} ariaLabel="Solicitudes por estado" />
          </ChartSection>
          <ChartSection
            title="Ítems por estado"
            summary={statusSummary(itemItems, { singular: "ítem", plural: "ítems" })}
            empty={itemItems.length === 0 ? { label: "Sin ítems en el período", hint: "Cambia el período o la faena para ver otros." } : null}
          >
            <RankedList items={itemItems} format="count" mode="share" order="input" limit={itemItems.length} ariaLabel="Ítems por estado" />
          </ChartSection>
          <ChartSection
            title="OC por estado"
            summary={statusSummary(orderItems, { singular: "OC", plural: "OC" })}
            empty={orderItems.length === 0 ? { label: "Sin OC en el período", hint: "Cambia el período o la faena para ver otras." } : null}
          >
            <RankedList items={orderItems} format="count" mode="share" order="input" limit={orderItems.length} ariaLabel="OC por estado" />
          </ChartSection>
        </section>

        <ChartSection
          title="Pendiente de abastecimiento por faena"
          summary={backlogSummary(backlog)}
          data={{
            caption: "Ítems sin OC y OC por recibir, por faena",
            headers: ["Faena", "Ítems sin OC", "OC por recibir"],
            rows: backlog.map((row) => [row.label, row.withoutOrder, row.pendingReceipt]),
          }}
          empty={backlog.length === 0 ? { label: "No hay nada pendiente de abastecimiento", hint: "Aparece cuando hay ítems aprobados sin orden de compra u OC enviadas esperando recepción." } : null}
        >
          <GroupedBarList
            rows={backlog.map((row) => ({ key: row.key, label: row.label, values: { withoutOrder: row.withoutOrder, pendingReceipt: row.pendingReceipt } }))}
            series={BACKLOG_SERIES}
            ariaLabel="Pendiente de abastecimiento por faena"
          />
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
            {itemsSinOcTotal > 0 && (
              <Link href="/compras/nueva" className="inline-flex min-h-8 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                Generar orden de compra
              </Link>
            )}
            {ocPendingTotal > 0 && (
              <Link href="/recepcion" className="inline-flex min-h-8 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                Ir a recepción
              </Link>
            )}
          </div>
        </ChartSection>
      </div>
    </PageContainer>
  )
}

function eqRequestItemRequest() {
  return eq(purchaseRequestItems.requestId, purchaseRequests.id)
}
