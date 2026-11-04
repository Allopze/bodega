import type { Session } from "next-auth"
import { and, count, isNull, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, purchaseOrders } from "@/db/schema"
import { isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import {
  reconciliationMonths,
  type DteCoverageRow,
  type ReconciliationRow,
} from "@/lib/purchasing/reconciliation-charts"
import { todayInChile } from "@/lib/utils"

/**
 * Consultas de los gráficos de `/compras/dte` (CHART-034). Qué significa cada
 * número vive en `lib/purchasing/reconciliation-charts.ts`; aquí sólo se leen
 * los insumos.
 */

/**
 * OC emitidas por mes de emisión (hora de Chile) y estado de conciliación, con el
 * monto que queda por facturar.
 *
 * - **Alcance.** Acotado a las faenas de la sesión con `worksiteScopeSql`, igual
 *   que la lista de Compras: quien ve la faena A no cuenta ni una OC de la B.
 * - **Qué es una OC emitida.** Ni borrador, ni anulada, ni eliminada (la
 *   eliminación es lógica: `deleted_at`) y con fecha de emisión.
 * - **Por facturar** = max(0, total de la OC − facturado), por OC. Se suman las
 *   facturas vigentes: una nota de crédito resta (su monto es negativo) y una
 *   factura anulada (FAC-002) no cuenta. El estado de conciliación es una
 *   proyección guardada en la OC; este monto se calcula en vivo.
 * - **Mes.** `issued_at` es un instante ISO en texto; las filas antiguas pueden
 *   traer sólo la fecha («2026-03-05»), que no se convierte de zona: pasar un
 *   «2026-03-01» por `timestamptz` lo dejaría en febrero.
 */
export async function getOrderReconciliationByMonth(
  session: Session | null,
  options: { today?: string; months?: number } = {},
): Promise<ReconciliationRow[]> {
  const window = reconciliationMonths(options.today ?? todayInChile(), options.months)
  const issuedMonth = sql`case when length(${purchaseOrders.issuedAt}) = 10 then left(${purchaseOrders.issuedAt}, 7) else to_char((${purchaseOrders.issuedAt})::timestamptz at time zone 'America/Santiago', 'YYYY-MM') end`
  const invoiced = sql`coalesce((select sum(${purchaseOrderInvoices.amount}) from ${purchaseOrderInvoices} where ${purchaseOrderInvoices.purchaseOrderId} = ${purchaseOrders.id} and ${purchaseOrderInvoices.voidedAt} is null), 0)`
  const remaining = sql`greatest(${purchaseOrders.totalAmount} - ${invoiced}, 0)`

  const rows = await db
    .select({
      month: sql<string>`${issuedMonth}`,
      status: purchaseOrders.invoiceReconciliationStatus,
      count: count(),
      toInvoice: sql<number>`coalesce(sum(${remaining}), 0)`,
      withBalance: sql<number>`count(*) filter (where ${remaining} > 0)`,
    })
    .from(purchaseOrders)
    .where(and(
      worksiteScopeSql(session, purchaseOrders.worksiteId),
      isNull(purchaseOrders.deletedAt),
      notInArray(purchaseOrders.status, ["draft", "cancelled"]),
      sql`${purchaseOrders.issuedAt} is not null`,
      sql`${issuedMonth} >= ${window[0]!}`,
    ))
    .groupBy(issuedMonth, purchaseOrders.invoiceReconciliationStatus)

  return rows.map((row) => ({
    month: String(row.month),
    status: row.status,
    count: Number(row.count),
    toInvoice: Number(row.toInvoice ?? 0),
    withBalance: Number(row.withBalance ?? 0),
  }))
}

/**
 * DTE recibidos por período de sincronización y vínculo (a una factura de OC, a
 * una carga de combustible o sin vincular).
 *
 * **`dte_documents` no tiene faena**: es por empresa (`cod_emp`), así que esta
 * serie es de toda la empresa y sólo la ve un rol con visibilidad global. Quien
 * está acotado a algunas faenas recibe `null` —no «cero documentos»—: darle los
 * conteos de la empresa le mostraría cifras de faenas que no puede ver, y darle
 * cero mentiría. (La lista de la misma pantalla ya es de empresa; el agregado no
 * amplía lo que ve, pero esta decisión es de quien administra el acceso, no de
 * un gráfico.)
 *
 * - **Universo.** El mismo de la lista: `cod_emp` y `periodo` (el período con que
 *   la lista filtra), de modo que una barra y las filas a las que lleva cuenten
 *   igual. Se excluyen los anulados en el SII (`estado_sii = 'anulado'`).
 * - **Monto.** Σ del total del documento; una nota de crédito viene negativa y resta.
 */
export async function getDteCoverageByPeriod(
  session: Session | null,
  codEmp: string,
  options: { today?: string; months?: number } = {},
): Promise<DteCoverageRow[] | null> {
  if (!isGlobalRole(session)) return null
  const window = reconciliationMonths(options.today ?? todayInChile(), options.months)
  const link = sql<string>`case when ${dteDocuments.purchaseOrderInvoiceId} is not null then 'oc' when ${dteDocuments.fuelLoadId} is not null then 'combustible' else 'none' end`

  const rows = await db
    .select({
      periodo: dteDocuments.periodo,
      link,
      count: count(),
      amount: sql<number>`coalesce(sum(${dteDocuments.montoTotal}), 0)`,
    })
    .from(dteDocuments)
    .where(and(
      sql`${dteDocuments.codEmp} = ${codEmp}`,
      sql`${dteDocuments.periodo} >= ${window[0]!}`,
      sql`${dteDocuments.periodo} <= ${window[window.length - 1]!}`,
      sql`(${dteDocuments.estadoSii} is null or ${dteDocuments.estadoSii} <> 'anulado')`,
    ))
    .groupBy(dteDocuments.periodo, link)

  return rows.map((row) => ({
    periodo: row.periodo,
    link: row.link,
    count: Number(row.count),
    amount: Number(row.amount ?? 0),
  }))
}
