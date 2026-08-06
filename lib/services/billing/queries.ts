/**
 * lib/services/billing/queries.ts
 *
 * Modelo de lectura de Facturación y Cobranza.
 *
 * Todas las consultas:
 * - **respetan el alcance por faena** (`resolveWorksiteScope`). Un rol no global
 *   solo ve facturas vinculadas —con vínculo *confirmado*— a sus faenas. Una
 *   sugerencia automática no otorga visibilidad;
 * - **no suman monedas distintas**: todo total agregado viene por moneda;
 * - **excluyen las anuladas** de la facturación válida, sin borrarlas;
 * - devuelven la fecha de última sincronización para que la UI pueda decir
 *   cuándo se miró la fuente.
 */

import type { Session } from "next-auth"
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  billingCollectionActions,
  billingExternalRefs,
  billingInvoiceEvents,
  billingInvoiceItems,
  billingInvoiceLinks,
  billingInvoicePayments,
  billingInvoices,
  billingProposals,
  billingSyncRuns,
  clients,
  contracts,
  users,
  worksites,
  type BillingProviderId,
} from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { agingBucketFor, AGING_BUCKETS, type AgingBucketId } from "./config"
import { addAmounts, sumByCurrency, type MoneyAmount } from "./money"
import { daysOverdue } from "./invoices"

export interface InvoiceFilters {
  /** Período de emisión "YYYY-MM". */
  period?: string
  /** Rango explícito; gana sobre `period`. */
  from?: string
  to?: string
  clientId?: string
  contractId?: string
  worksiteId?: string
  paymentStatus?: "unpaid" | "partial" | "paid" | "overpaid"
  collectionStatus?: string
  documentStatus?: string
  source?: BillingProviderId
  currency?: string
  ownerUserId?: string
  /** Solo vencidas al día de hoy. */
  overdueOnly?: boolean
  /** Solo facturas sin vínculo operacional confirmado (`?sinVinculo=1`). */
  unlinkedOnly?: boolean
  /** Búsqueda por folio o RUT. */
  search?: string
  page?: number
  pageSize?: number
}

export interface InvoiceListRow {
  id: string
  docType: string
  folio: number
  counterpartyTaxId: string
  counterpartyName: string
  issueDate: string
  dueDate: string | null
  dueDateSource: string | null
  currency: string
  netAmount: number | null
  taxAmount: number | null
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  documentStatus: string
  paymentStatus: string
  collectionStatus: string
  source: BillingProviderId
  sourceLastSyncedAt: string | null
  ownerName: string | null
  clientName: string | null
  contractCode: string | null
  worksiteName: string | null
  daysOverdue: number | null
  agingBucket: AgingBucketId | null
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

/* ── Alcance ─────────────────────────────────────────────────────────────── */

/**
 * Predicado de visibilidad para facturas según el alcance del rol.
 *
 * Un rol global ve todo. Un rol acotado ve solo las facturas con un vínculo
 * **confirmado** a alguna de sus faenas: una sugerencia automática no puede
 * abrir acceso a información financiera.
 *
 * `null` = sin filtro. `false` = cero filas.
 */
function invoiceScopePredicate(session: Session | null): SQL | null | false {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return null
  if (scope.mode === "none") return false

  return sql`EXISTS (
    SELECT 1 FROM ${billingInvoiceLinks}
    WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoices.id}
      AND ${billingInvoiceLinks.status} = 'confirmed'
      AND ${billingInvoiceLinks.worksiteId} IN ${scope.ids}
  )`
}

/**
 * ¿La sesión alcanza esta factura?
 *
 * Misma regla que `invoiceScopePredicate`, en forma de guarda puntual para las
 * acciones de escritura: una acción no puede confiar en que la pantalla filtró
 * bien. Vive acá —y no en un archivo de acciones— porque **todas** las
 * escrituras que reciben un `invoiceId` deben usarla; tenerla privada en
 * Cobranza dejó al resto del módulo sin verificar el alcance del registro que
 * modificaba (H-08, AUDITORIA_BUGS_2026-08-05.md).
 */
export async function canReachInvoice(session: Session | null, invoiceId: string): Promise<boolean> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return true
  if (scope.mode === "none") return false

  const rows = await db
    .select({ id: billingInvoiceLinks.id })
    .from(billingInvoiceLinks)
    .where(and(
      eq(billingInvoiceLinks.invoiceId, invoiceId),
      eq(billingInvoiceLinks.status, "confirmed"),
      inArray(billingInvoiceLinks.worksiteId, scope.ids),
    ))
    .limit(1)

  return rows.length > 0
}

/**
 * ¿La sesión alcanza esta propuesta?
 *
 * Una propuesta lleva su faena en la fila, así que la regla es directa: un rol
 * acotado sólo llega a las de sus faenas. Una propuesta sin faena es visible
 * sólo para un rol global.
 */
export async function canReachProposal(session: Session | null, proposalId: string): Promise<boolean> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return true
  if (scope.mode === "none") return false

  const rows = await db
    .select({ worksiteId: billingProposals.worksiteId })
    .from(billingProposals)
    .where(eq(billingProposals.id, proposalId))
    .limit(1)

  const worksiteId = rows[0]?.worksiteId
  return Boolean(worksiteId && scope.ids.includes(worksiteId))
}

/* ── Listado ─────────────────────────────────────────────────────────────── */

export interface InvoiceListResult {
  rows: InvoiceListRow[]
  total: number
  page: number
  pageSize: number
  /** Totales por moneda del conjunto filtrado completo (no solo la página). */
  totalsByCurrency: MoneyAmount[]
  outstandingByCurrency: MoneyAmount[]
}

/**
 * Facturas de venta con filtros y paginación en servidor.
 *
 * `direction` es un parámetro y no un filtro opcional: quien consulta tiene que
 * decir si mira cuentas por cobrar o facturas de proveedor. No hay una vista
 * que las mezcle por accidente.
 */
export async function listInvoices(
  session: Session | null,
  direction: "sale" | "purchase",
  filters: InvoiceFilters = {},
): Promise<InvoiceListResult> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE))
  const today = todayIso()

  const scope = invoiceScopePredicate(session)
  if (scope === false) {
    return { rows: [], total: 0, page, pageSize, totalsByCurrency: [], outstandingByCurrency: [] }
  }

  const where = and(
    eq(billingInvoices.direction, direction),
    ...(scope ? [scope] : []),
    ...buildInvoiceConditions(filters, today),
  )

  const [rows, aggregates] = await Promise.all([
    db
      .select({
        id: billingInvoices.id,
        docType: billingInvoices.docType,
        folio: billingInvoices.folio,
        issuerTaxId: billingInvoices.issuerTaxId,
        issuerName: billingInvoices.issuerName,
        receiverTaxId: billingInvoices.receiverTaxId,
        receiverName: billingInvoices.receiverName,
        issueDate: billingInvoices.issueDate,
        dueDate: billingInvoices.dueDate,
        dueDateSource: billingInvoices.dueDateSource,
        currency: billingInvoices.currency,
        netAmount: billingInvoices.netAmount,
        taxAmount: billingInvoices.taxAmount,
        totalAmount: billingInvoices.totalAmount,
        paidAmount: billingInvoices.paidAmount,
        documentStatus: billingInvoices.documentStatus,
        paymentStatus: billingInvoices.paymentStatus,
        collectionStatus: billingInvoices.collectionStatus,
        source: billingInvoices.source,
        sourceLastSyncedAt: billingInvoices.sourceLastSyncedAt,
        ownerName: users.name,
      })
      .from(billingInvoices)
      .leftJoin(users, eq(users.id, billingInvoices.ownerUserId))
      .where(where)
      .orderBy(desc(billingInvoices.issueDate), desc(billingInvoices.folio))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        currency: billingInvoices.currency,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${billingInvoices.totalAmount}), 0)::float8`,
        paid: sql<number>`coalesce(sum(${billingInvoices.paidAmount}), 0)::float8`,
      })
      .from(billingInvoices)
      .where(where)
      .groupBy(billingInvoices.currency),
  ])

  const total = aggregates.reduce((sum, row) => sum + row.count, 0)
  const invoiceIds = rows.map((row) => row.id)
  const linkContext = await loadLinkContext(invoiceIds)

  return {
    rows: rows.map((row) => {
      const overdue = row.dueDate ? daysOverdue(row.dueDate, today) : null
      const context = linkContext.get(row.id)
      const isSale = direction === "sale"
      return {
        id: row.id,
        docType: row.docType,
        folio: row.folio,
        counterpartyTaxId: isSale ? row.receiverTaxId : row.issuerTaxId,
        counterpartyName: isSale ? row.receiverName : row.issuerName,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        dueDateSource: row.dueDateSource,
        currency: row.currency,
        netAmount: row.netAmount,
        taxAmount: row.taxAmount,
        totalAmount: row.totalAmount,
        paidAmount: row.paidAmount,
        outstandingAmount: addAmounts(row.totalAmount, -row.paidAmount),
        documentStatus: row.documentStatus,
        paymentStatus: row.paymentStatus,
        collectionStatus: row.collectionStatus,
        source: row.source,
        sourceLastSyncedAt: row.sourceLastSyncedAt,
        ownerName: row.ownerName,
        clientName: context?.clientName ?? null,
        contractCode: context?.contractCode ?? null,
        worksiteName: context?.worksiteName ?? null,
        daysOverdue: overdue,
        // Solo tiene sentido hablar de antigüedad si queda algo por cobrar.
        agingBucket: overdue === null || row.paymentStatus === "paid" ? null : agingBucketFor(overdue),
      }
    }),
    total,
    page,
    pageSize,
    totalsByCurrency: sumByCurrency(aggregates.map((row) => ({ currency: row.currency, amount: row.total }))),
    outstandingByCurrency: sumByCurrency(
      aggregates.map((row) => ({ currency: row.currency, amount: addAmounts(row.total, -row.paid) })),
    ),
  }
}

function buildInvoiceConditions(filters: InvoiceFilters, today: string): SQL[] {
  const conditions: SQL[] = []

  if (filters.from) conditions.push(gte(billingInvoices.issueDate, filters.from))
  if (filters.to) conditions.push(lte(billingInvoices.issueDate, filters.to))
  if (!filters.from && !filters.to && filters.period) {
    conditions.push(gte(billingInvoices.issueDate, `${filters.period}-01`))
    conditions.push(lte(billingInvoices.issueDate, endOfMonth(filters.period)))
  }
  if (filters.paymentStatus) conditions.push(eq(billingInvoices.paymentStatus, filters.paymentStatus))
  if (filters.collectionStatus) {
    conditions.push(sql`${billingInvoices.collectionStatus} = ${filters.collectionStatus}`)
  }
  if (filters.documentStatus) {
    conditions.push(sql`${billingInvoices.documentStatus} = ${filters.documentStatus}`)
  } else {
    // Por defecto las anuladas no aparecen en la facturación válida; se pueden
    // pedir explícitamente con documentStatus=void.
    conditions.push(ne(billingInvoices.documentStatus, "void"))
  }
  if (filters.source) conditions.push(eq(billingInvoices.source, filters.source))
  if (filters.currency) conditions.push(eq(billingInvoices.currency, filters.currency))
  if (filters.ownerUserId) conditions.push(eq(billingInvoices.ownerUserId, filters.ownerUserId))

  if (filters.overdueOnly) {
    conditions.push(sql`${billingInvoices.dueDate} IS NOT NULL AND ${billingInvoices.dueDate} < ${today}`)
    conditions.push(ne(billingInvoices.paymentStatus, "paid"))
  }

  // Mismo criterio de "sin relación con la operación" que listUnlinkedInvoices:
  // ningún vínculo confirmado. El dashboard enlazaba ?sinVinculo=1 sin que
  // ningún código lo leyera — el usuario llegaba a la lista completa sin aviso.
  if (filters.unlinkedOnly) {
    conditions.push(sql`NOT EXISTS (
      SELECT 1 FROM ${billingInvoiceLinks}
      WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoices.id}
        AND ${billingInvoiceLinks.status} = 'confirmed'
    )`)
  }

  if (filters.clientId || filters.contractId || filters.worksiteId) {
    const linkConditions: SQL[] = [sql`${billingInvoiceLinks.status} <> 'rejected'`]
    if (filters.clientId) linkConditions.push(eq(billingInvoiceLinks.clientId, filters.clientId))
    if (filters.contractId) linkConditions.push(eq(billingInvoiceLinks.contractId, filters.contractId))
    if (filters.worksiteId) linkConditions.push(eq(billingInvoiceLinks.worksiteId, filters.worksiteId))
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${billingInvoiceLinks}
      WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoices.id}
        AND ${and(...linkConditions)}
    )`)
  }

  const search = filters.search?.trim()
  if (search) {
    const folio = Number.parseInt(search.replace(/\D/g, ""), 10)
    const like = `%${search.toLowerCase()}%`
    const clauses: SQL[] = [
      sql`lower(${billingInvoices.receiverName}) LIKE ${like}`,
      sql`lower(${billingInvoices.issuerName}) LIKE ${like}`,
      sql`lower(${billingInvoices.receiverTaxId}) LIKE ${like}`,
      sql`lower(${billingInvoices.issuerTaxId}) LIKE ${like}`,
    ]
    if (Number.isSafeInteger(folio) && folio > 0) clauses.push(eq(billingInvoices.folio, folio))
    conditions.push(or(...clauses)!)
  }

  return conditions
}

/** Contexto operacional (cliente/contrato/faena) de un lote de facturas. */
async function loadLinkContext(invoiceIds: string[]): Promise<Map<string, {
  clientName: string | null
  contractCode: string | null
  worksiteName: string | null
}>> {
  if (invoiceIds.length === 0) return new Map()

  const rows = await db
    .select({
      invoiceId: billingInvoiceLinks.invoiceId,
      status: billingInvoiceLinks.status,
      clientName: clients.name,
      contractCode: contracts.code,
      worksiteName: worksites.name,
    })
    .from(billingInvoiceLinks)
    .leftJoin(clients, eq(clients.id, billingInvoiceLinks.clientId))
    .leftJoin(contracts, eq(contracts.id, billingInvoiceLinks.contractId))
    .leftJoin(worksites, eq(worksites.id, billingInvoiceLinks.worksiteId))
    .where(and(
      inArray(billingInvoiceLinks.invoiceId, invoiceIds),
      ne(billingInvoiceLinks.status, "rejected"),
    ))
    // Un vínculo confirmado gana sobre una sugerencia al resumir en una fila.
    .orderBy(asc(billingInvoiceLinks.status))

  const context = new Map<string, { clientName: string | null; contractCode: string | null; worksiteName: string | null }>()
  for (const row of rows) {
    const existing = context.get(row.invoiceId)
    context.set(row.invoiceId, {
      clientName: existing?.clientName ?? row.clientName,
      contractCode: existing?.contractCode ?? row.contractCode,
      worksiteName: existing?.worksiteName ?? row.worksiteName,
    })
  }
  return context
}

/* ── Detalle ─────────────────────────────────────────────────────────────── */

export async function getInvoiceDetail(session: Session | null, invoiceId: string) {
  const scope = invoiceScopePredicate(session)
  if (scope === false) return null

  const rows = await db
    .select()
    .from(billingInvoices)
    .where(and(eq(billingInvoices.id, invoiceId), ...(scope ? [scope] : [])))
    .limit(1)

  const invoice = rows[0]
  if (!invoice) return null

  const [items, externalRefs, links, payments, collectionActions, events] = await Promise.all([
    db.select().from(billingInvoiceItems)
      .where(eq(billingInvoiceItems.invoiceId, invoiceId))
      .orderBy(asc(billingInvoiceItems.sortOrder)),
    db.select().from(billingExternalRefs)
      .where(eq(billingExternalRefs.invoiceId, invoiceId))
      .orderBy(asc(billingExternalRefs.provider)),
    db.select({
      link: billingInvoiceLinks,
      clientName: clients.name,
      contractCode: contracts.code,
      contractName: contracts.name,
      worksiteName: worksites.name,
      confirmedByName: users.name,
    })
      .from(billingInvoiceLinks)
      .leftJoin(clients, eq(clients.id, billingInvoiceLinks.clientId))
      .leftJoin(contracts, eq(contracts.id, billingInvoiceLinks.contractId))
      .leftJoin(worksites, eq(worksites.id, billingInvoiceLinks.worksiteId))
      .leftJoin(users, eq(users.id, billingInvoiceLinks.confirmedBy))
      .where(eq(billingInvoiceLinks.invoiceId, invoiceId)),
    db.select({
      payment: billingInvoicePayments,
      confirmedByName: users.name,
    })
      .from(billingInvoicePayments)
      .leftJoin(users, eq(users.id, billingInvoicePayments.confirmedBy))
      .where(eq(billingInvoicePayments.invoiceId, invoiceId))
      .orderBy(desc(billingInvoicePayments.paymentDate)),
    db.select({
      action: billingCollectionActions,
      authorName: users.name,
    })
      .from(billingCollectionActions)
      .leftJoin(users, eq(users.id, billingCollectionActions.createdBy))
      .where(eq(billingCollectionActions.invoiceId, invoiceId))
      .orderBy(desc(billingCollectionActions.actionDate)),
    db.select({
      event: billingInvoiceEvents,
      actorName: users.name,
    })
      .from(billingInvoiceEvents)
      .leftJoin(users, eq(users.id, billingInvoiceEvents.actorUserId))
      .where(eq(billingInvoiceEvents.invoiceId, invoiceId))
      .orderBy(desc(billingInvoiceEvents.occurredAt))
      .limit(200),
  ])

  const today = todayIso()
  return {
    invoice,
    items,
    externalRefs,
    links,
    payments,
    collectionActions,
    events,
    outstandingAmount: addAmounts(invoice.totalAmount, -invoice.paidAmount),
    daysOverdue: invoice.dueDate ? daysOverdue(invoice.dueDate, today) : null,
    /** Diferencias entre lo que reportó cada fuente externa. */
    sourceDifferences: computeSourceDifferences(externalRefs),
  }
}

export interface SourceDifference {
  field: string
  values: { provider: string; value: string }[]
}

/**
 * Compara los snapshots de las fuentes externas y reporta dónde no coinciden.
 * No decide quién tiene razón: eso lo resuelve la matriz de responsabilidades y,
 * si hace falta, una persona.
 */
export function computeSourceDifferences(
  refs: readonly { provider: string; snapshot: unknown }[],
): SourceDifference[] {
  if (refs.length < 2) return []

  const fields = ["totalAmount", "netAmount", "taxAmount", "exemptAmount", "dueDate", "documentStatus"] as const
  const differences: SourceDifference[] = []

  for (const field of fields) {
    const values = refs.map((ref) => ({
      provider: ref.provider,
      value: String((ref.snapshot as Record<string, unknown> | null)?.[field] ?? "—"),
    }))
    if (new Set(values.map((entry) => entry.value)).size > 1) {
      differences.push({ field, values })
    }
  }
  return differences
}

/* ── Resumen ─────────────────────────────────────────────────────────────── */

export interface BillingSummary {
  period: string
  generatedAt: string
  /** Facturado en el período, por moneda, excluyendo anuladas. */
  invoicedByCurrency: MoneyAmount[]
  /** Cobrado: pagos confirmados imputados a facturas del período. */
  collectedByCurrency: MoneyAmount[]
  /** Saldo pendiente de todas las facturas abiertas (no solo del período). */
  outstandingByCurrency: MoneyAmount[]
  /** Saldo vencido al día de hoy. */
  overdueByCurrency: MoneyAmount[]
  invoiceCount: number
  overdueCount: number
  /** Promedio de días entre emisión y último pago confirmado. Null si no hay datos. */
  averageDaysToPay: number | null
  aging: { bucket: AgingBucketId; label: string; count: number; byCurrency: MoneyAmount[] }[]
  topClients: { clientName: string; currency: string; amount: number }[]
  byWorksite: { worksiteName: string; currency: string; amount: number }[]
  monthly: { period: string; currency: string; invoiced: number; collected: number }[]
  providerStatus: {
    provider: BillingProviderId
    scope: string
    status: string
    startedAt: string
    finishedAt: string | null
    recordsFetched: number
    errorSummary: string | null
  }[]
}

/**
 * Indicadores del módulo. Cada cifra sale de una consulta explícita: no hay
 * números decorativos ni estimaciones.
 */
export async function getBillingSummary(
  session: Session | null,
  options: { period?: string; worksiteId?: string } = {},
): Promise<BillingSummary> {
  const period = options.period ?? todayIso().slice(0, 7)
  const today = todayIso()
  const scope = invoiceScopePredicate(session)

  const empty: BillingSummary = {
    period,
    generatedAt: new Date().toISOString(),
    invoicedByCurrency: [],
    collectedByCurrency: [],
    outstandingByCurrency: [],
    overdueByCurrency: [],
    invoiceCount: 0,
    overdueCount: 0,
    averageDaysToPay: null,
    aging: AGING_BUCKETS.map((bucket) => ({ bucket: bucket.id, label: bucket.label, count: 0, byCurrency: [] })),
    topClients: [],
    byWorksite: [],
    monthly: [],
    providerStatus: [],
  }
  if (scope === false) return empty

  const saleScope = [eq(billingInvoices.direction, "sale"), ne(billingInvoices.documentStatus, "void")]
  if (scope) saleScope.push(scope)
  if (options.worksiteId) {
    saleScope.push(sql`EXISTS (
      SELECT 1 FROM ${billingInvoiceLinks}
      WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoices.id}
        AND ${billingInvoiceLinks.worksiteId} = ${options.worksiteId}
        AND ${billingInvoiceLinks.status} <> 'rejected'
    )`)
  }

  const periodStart = `${period}-01`
  const periodEnd = endOfMonth(period)

  const [periodRows, openRows, agingRows, clientRows, worksiteRows, monthlyRows, paidRows, runs] = await Promise.all([
    // Facturado y cobrado del período.
    db.select({
      currency: billingInvoices.currency,
      count: sql<number>`count(*)::int`,
      invoiced: sql<number>`coalesce(sum(${billingInvoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${billingInvoices.paidAmount}), 0)::float8`,
    })
      .from(billingInvoices)
      .where(and(...saleScope, gte(billingInvoices.issueDate, periodStart), lte(billingInvoices.issueDate, periodEnd)))
      .groupBy(billingInvoices.currency),

    // Saldo abierto y vencido (todas las facturas, no solo del período).
    db.select({
      currency: billingInvoices.currency,
      outstanding: sql<number>`coalesce(sum(${billingInvoices.totalAmount} - ${billingInvoices.paidAmount}), 0)::float8`,
      overdue: sql<number>`coalesce(sum(CASE WHEN ${billingInvoices.dueDate} IS NOT NULL AND ${billingInvoices.dueDate} < ${today} THEN ${billingInvoices.totalAmount} - ${billingInvoices.paidAmount} ELSE 0 END), 0)::float8`,
      overdueCount: sql<number>`count(CASE WHEN ${billingInvoices.dueDate} IS NOT NULL AND ${billingInvoices.dueDate} < ${today} THEN 1 END)::int`,
    })
      .from(billingInvoices)
      .where(and(...saleScope, ne(billingInvoices.paymentStatus, "paid")))
      .groupBy(billingInvoices.currency),

    // Antigüedad de deuda.
    db.select({
      currency: billingInvoices.currency,
      dueDate: billingInvoices.dueDate,
      outstanding: sql<number>`(${billingInvoices.totalAmount} - ${billingInvoices.paidAmount})::float8`,
    })
      .from(billingInvoices)
      .where(and(...saleScope, ne(billingInvoices.paymentStatus, "paid"))),

    // Principales clientes por facturación del período.
    db.select({
      clientName: clients.name,
      currency: billingInvoices.currency,
      amount: sql<number>`coalesce(sum(${billingInvoices.totalAmount}), 0)::float8`,
    })
      .from(billingInvoices)
      .innerJoin(billingInvoiceLinks, and(
        eq(billingInvoiceLinks.invoiceId, billingInvoices.id),
        ne(billingInvoiceLinks.status, "rejected"),
      ))
      .innerJoin(clients, eq(clients.id, billingInvoiceLinks.clientId))
      .where(and(...saleScope, gte(billingInvoices.issueDate, periodStart), lte(billingInvoices.issueDate, periodEnd)))
      .groupBy(clients.name, billingInvoices.currency)
      .orderBy(desc(sql`coalesce(sum(${billingInvoices.totalAmount}), 0)`))
      .limit(10),

    // Facturación por faena.
    db.select({
      worksiteName: worksites.name,
      currency: billingInvoices.currency,
      amount: sql<number>`coalesce(sum(${billingInvoices.totalAmount}), 0)::float8`,
    })
      .from(billingInvoices)
      .innerJoin(billingInvoiceLinks, and(
        eq(billingInvoiceLinks.invoiceId, billingInvoices.id),
        ne(billingInvoiceLinks.status, "rejected"),
      ))
      .innerJoin(worksites, eq(worksites.id, billingInvoiceLinks.worksiteId))
      .where(and(...saleScope, gte(billingInvoices.issueDate, periodStart), lte(billingInvoices.issueDate, periodEnd)))
      .groupBy(worksites.name, billingInvoices.currency)
      .orderBy(desc(sql`coalesce(sum(${billingInvoices.totalAmount}), 0)`))
      .limit(15),

    // Evolución de los últimos 12 meses.
    db.select({
      period: sql<string>`substring(${billingInvoices.issueDate} from 1 for 7)`,
      currency: billingInvoices.currency,
      invoiced: sql<number>`coalesce(sum(${billingInvoices.totalAmount}), 0)::float8`,
      collected: sql<number>`coalesce(sum(${billingInvoices.paidAmount}), 0)::float8`,
    })
      .from(billingInvoices)
      .where(and(...saleScope, gte(billingInvoices.issueDate, monthsAgo(period, 11))))
      .groupBy(sql`substring(${billingInvoices.issueDate} from 1 for 7)`, billingInvoices.currency)
      .orderBy(asc(sql`substring(${billingInvoices.issueDate} from 1 for 7)`)),

    // Días promedio de pago: emisión → último pago confirmado.
    db.select({
      issueDate: billingInvoices.issueDate,
      lastPaymentDate: sql<string>`max(${billingInvoicePayments.paymentDate})`,
    })
      .from(billingInvoices)
      .innerJoin(billingInvoicePayments, and(
        eq(billingInvoicePayments.invoiceId, billingInvoices.id),
        eq(billingInvoicePayments.verificationStatus, "confirmed"),
      ))
      .where(and(...saleScope, eq(billingInvoices.paymentStatus, "paid")))
      .groupBy(billingInvoices.id, billingInvoices.issueDate),

    listRecentSyncRuns(6),
  ])

  const agingByBucket = new Map<AgingBucketId, { count: number; amounts: MoneyAmount[] }>()
  for (const row of agingRows) {
    const bucket = row.dueDate ? agingBucketFor(daysOverdue(row.dueDate, today)) : "not_due"
    const entry = agingByBucket.get(bucket) ?? { count: 0, amounts: [] }
    entry.count++
    entry.amounts.push({ currency: row.currency, amount: row.outstanding })
    agingByBucket.set(bucket, entry)
  }

  const daysToPay = paidRows
    .filter((row) => row.lastPaymentDate)
    .map((row) => daysOverdue(row.issueDate, row.lastPaymentDate))

  return {
    period,
    generatedAt: new Date().toISOString(),
    invoicedByCurrency: sumByCurrency(periodRows.map((row) => ({ currency: row.currency, amount: row.invoiced }))),
    collectedByCurrency: sumByCurrency(periodRows.map((row) => ({ currency: row.currency, amount: row.collected }))),
    outstandingByCurrency: sumByCurrency(openRows.map((row) => ({ currency: row.currency, amount: row.outstanding }))),
    overdueByCurrency: sumByCurrency(openRows.map((row) => ({ currency: row.currency, amount: row.overdue }))),
    invoiceCount: periodRows.reduce((sum, row) => sum + row.count, 0),
    overdueCount: openRows.reduce((sum, row) => sum + row.overdueCount, 0),
    averageDaysToPay: daysToPay.length > 0
      ? Math.round(daysToPay.reduce((sum, days) => sum + days, 0) / daysToPay.length)
      : null,
    aging: AGING_BUCKETS.map((bucket) => {
      const entry = agingByBucket.get(bucket.id)
      return {
        bucket: bucket.id,
        label: bucket.label,
        count: entry?.count ?? 0,
        byCurrency: sumByCurrency(entry?.amounts ?? []),
      }
    }),
    topClients: clientRows.map((row) => ({ clientName: row.clientName, currency: row.currency, amount: row.amount })),
    byWorksite: worksiteRows.map((row) => ({ worksiteName: row.worksiteName, currency: row.currency, amount: row.amount })),
    monthly: monthlyRows.map((row) => ({
      period: row.period,
      currency: row.currency,
      invoiced: row.invoiced,
      collected: row.collected,
    })),
    providerStatus: runs.map((run) => ({
      provider: run.provider,
      scope: run.scope,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      recordsFetched: run.recordsFetched,
      errorSummary: run.errorSummary,
    })),
  }
}

/* ── Facturas sin relación operacional ───────────────────────────────────── */

/**
 * Facturas emitidas sin ningún vínculo confirmado a cliente/contrato/faena.
 * Es la contracara de "pendientes de facturar": trabajo cobrado que nadie
 * atribuyó a la operación.
 */
export async function listUnlinkedInvoices(session: Session | null, limit = 100) {
  const scope = invoiceScopePredicate(session)
  // Un rol acotado por faena no puede ver facturas sin faena asignada: por
  // definición no están en su alcance. Devolver vacío es lo correcto.
  if (scope !== null) return []

  return db
    .select({
      id: billingInvoices.id,
      docType: billingInvoices.docType,
      folio: billingInvoices.folio,
      receiverTaxId: billingInvoices.receiverTaxId,
      receiverName: billingInvoices.receiverName,
      issueDate: billingInvoices.issueDate,
      currency: billingInvoices.currency,
      totalAmount: billingInvoices.totalAmount,
    })
    .from(billingInvoices)
    .where(and(
      eq(billingInvoices.direction, "sale"),
      ne(billingInvoices.documentStatus, "void"),
      sql`NOT EXISTS (
        SELECT 1 FROM ${billingInvoiceLinks}
        WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoices.id}
          AND ${billingInvoiceLinks.status} = 'confirmed'
      )`,
    ))
    .orderBy(desc(billingInvoices.issueDate))
    .limit(limit)
}

/* ── Corridas de sincronización ──────────────────────────────────────────── */

export async function listRecentSyncRuns(limit = 30) {
  return db
    .select({
      id: billingSyncRuns.id,
      provider: billingSyncRuns.provider,
      scope: billingSyncRuns.scope,
      trigger: billingSyncRuns.trigger,
      status: billingSyncRuns.status,
      dryRun: billingSyncRuns.dryRun,
      periodFrom: billingSyncRuns.periodFrom,
      periodTo: billingSyncRuns.periodTo,
      cursor: billingSyncRuns.cursor,
      recordsFetched: billingSyncRuns.recordsFetched,
      recordsCreated: billingSyncRuns.recordsCreated,
      recordsUpdated: billingSyncRuns.recordsUpdated,
      recordsUnchanged: billingSyncRuns.recordsUnchanged,
      duplicatesDetected: billingSyncRuns.duplicatesDetected,
      conflictsDetected: billingSyncRuns.conflictsDetected,
      errorsCount: billingSyncRuns.errorsCount,
      errorSummary: billingSyncRuns.errorSummary,
      correlationId: billingSyncRuns.correlationId,
      startedAt: billingSyncRuns.startedAt,
      finishedAt: billingSyncRuns.finishedAt,
      triggeredByName: users.name,
    })
    .from(billingSyncRuns)
    .leftJoin(users, eq(users.id, billingSyncRuns.triggeredBy))
    .orderBy(desc(billingSyncRuns.startedAt))
    .limit(limit)
}

/** Última corrida exitosa por (proveedor, alcance). */
export async function getLastSuccessfulRuns() {
  return db
    .select({
      provider: billingSyncRuns.provider,
      scope: billingSyncRuns.scope,
      finishedAt: sql<string>`max(${billingSyncRuns.finishedAt})`,
    })
    .from(billingSyncRuns)
    .where(eq(billingSyncRuns.status, "success"))
    .groupBy(billingSyncRuns.provider, billingSyncRuns.scope)
}

/* ── Maestro comercial ───────────────────────────────────────────────────── */

export async function listClientsWithContracts() {
  const [clientRows, contractRows] = await Promise.all([
    db.select({
      id: clients.id,
      rut: clients.rut,
      name: clients.name,
      email: clients.email,
      phone: clients.phone,
      paymentTermsDays: clients.paymentTermsDays,
      defaultCurrency: clients.defaultCurrency,
      isActive: clients.isActive,
      ownerName: users.name,
    })
      .from(clients)
      .leftJoin(users, eq(users.id, clients.ownerUserId))
      .orderBy(asc(clients.name)),
    db.select({
      id: contracts.id,
      clientId: contracts.clientId,
      code: contracts.code,
      name: contracts.name,
      status: contracts.status,
      billingCycle: contracts.billingCycle,
      paymentTermsDays: contracts.paymentTermsDays,
      currency: contracts.currency,
      periodAmount: contracts.periodAmount,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      worksiteName: worksites.name,
    })
      .from(contracts)
      .leftJoin(worksites, eq(worksites.id, contracts.worksiteId))
      .orderBy(asc(contracts.code)),
  ])

  const contractsByClient = new Map<string, typeof contractRows>()
  for (const contract of contractRows) {
    const list = contractsByClient.get(contract.clientId) ?? []
    list.push(contract)
    contractsByClient.set(contract.clientId, list)
  }

  return clientRows.map((client) => ({
    ...client,
    contracts: contractsByClient.get(client.id) ?? [],
  }))
}

/** Clientes activos para selectores. */
export async function listActiveClients() {
  return db
    .select({ id: clients.id, rut: clients.rut, name: clients.name })
    .from(clients)
    .where(eq(clients.isActive, true))
    .orderBy(asc(clients.name))
}

/** Contratos activos, opcionalmente de un cliente. */
export async function listActiveContracts(clientId?: string) {
  const conditions = [eq(contracts.status, "active")]
  if (clientId) conditions.push(eq(contracts.clientId, clientId))
  return db
    .select({
      id: contracts.id,
      clientId: contracts.clientId,
      code: contracts.code,
      name: contracts.name,
      worksiteId: contracts.worksiteId,
      costCenterId: contracts.costCenterId,
      currency: contracts.currency,
      periodAmount: contracts.periodAmount,
      billingCycle: contracts.billingCycle,
      clientPoNumber: contracts.clientPoNumber,
    })
    .from(contracts)
    .where(and(...conditions))
    .orderBy(asc(contracts.code))
}

/* ── Helpers de fecha ────────────────────────────────────────────────────── */

/**
 * Hoy en la zona horaria de operación (America/Santiago). Usar UTC acá
 * adelantaría o atrasaría el "vencida hoy" según la hora del servidor.
 */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
}

export function endOfMonth(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number]
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function monthsAgo(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const date = new Date(Date.UTC(year, month - 1 - months, 1))
  return date.toISOString().slice(0, 10)
}
