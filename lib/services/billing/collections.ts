/**
 * lib/services/billing/collections.ts
 *
 * Modelo de lectura de la cobranza: las facturas agrupadas por la situación en
 * que están, no por un campo suelto.
 *
 * La clasificación combina tres cosas que suelen confundirse:
 * - **estado de pago** (¿cuánto se cobró?),
 * - **vencimiento** (¿ya se pasó el plazo?),
 * - **estado de gestión** (¿alguien está haciendo algo?).
 *
 * Un caso cae en exactamente un grupo, y el orden de evaluación importa: una
 * factura en disputa se muestra como disputa aunque además esté vencida, porque
 * lo que hay que hacer con ella es distinto.
 */

import type { Session } from "next-auth"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  billingCollectionActions,
  billingInvoiceLinks,
  billingInvoicePayments,
  billingInvoices,
  clients,
  contracts,
  users,
  worksites,
} from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { sumByCurrency, type MoneyAmount } from "./money"
import { daysOverdue, outstandingAmountFor } from "./invoices"
import { agingBucketFor, type AgingBucketId } from "./config"
import { todayIso } from "./queries"

export type CollectionBucket =
  | "disputed"
  | "committed"
  | "overdue"
  | "due_soon"
  | "partial"
  | "no_recent_activity"
  | "pending"
  | "paid"

export const COLLECTION_BUCKETS: { id: CollectionBucket; label: string; description: string }[] = [
  { id: "disputed",           label: "En disputa",            description: "El cliente objetó el cobro. Requiere resolución antes de insistir." },
  { id: "committed",          label: "Con compromiso de pago", description: "El cliente comprometió una fecha; hay que hacer seguimiento." },
  { id: "overdue",            label: "Vencidas",              description: "Pasó el plazo y queda saldo." },
  { id: "due_soon",           label: "Próximas a vencer",     description: "Vencen dentro de los próximos 7 días." },
  { id: "partial",            label: "Parcialmente pagadas",  description: "Tienen pagos confirmados por menos del total." },
  { id: "no_recent_activity", label: "Sin gestión reciente",  description: "Más de 30 días sin ninguna gestión registrada." },
  { id: "pending",            label: "Pendientes en plazo",   description: "Emitidas, dentro de plazo y sin nada que objetar." },
  { id: "paid",               label: "Pagadas",               description: "Saldo cubierto por pagos confirmados." },
]

/** Días sin gestión a partir de los cuales una factura abierta se considera abandonada. */
const STALE_ACTIVITY_DAYS = 30
/** Ventana de "próxima a vencer". */
const DUE_SOON_DAYS = 7

export interface CollectionRow {
  invoiceId: string
  docType: string
  folio: number
  clientName: string
  clientTaxId: string
  contractCode: string | null
  worksiteName: string | null
  issueDate: string
  dueDate: string | null
  currency: string
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  paymentStatus: string
  collectionStatus: string
  daysOverdue: number | null
  agingBucket: AgingBucketId | null
  bucket: CollectionBucket
  ownerName: string | null
  lastActionDate: string | null
  lastActionType: string | null
  daysSinceLastAction: number | null
  commitmentDate: string | null
  suggestedPayments: number
}

export interface CollectionsView {
  today: string
  rows: CollectionRow[]
  buckets: { id: CollectionBucket; label: string; description: string; count: number; byCurrency: MoneyAmount[] }[]
  totalOutstanding: MoneyAmount[]
}

/**
 * Clasifica una factura en un grupo de cobranza.
 *
 * Función pura y exportada para poder probar la regla sin base de datos: es el
 * corazón de la pantalla y equivocarse acá cambia a quién se le llama mañana.
 */
export function classifyCollection(input: {
  paymentStatus: string
  collectionStatus: string
  daysOverdue: number | null
  daysSinceLastAction: number | null
}): CollectionBucket {
  // Sobrepagada también está cubierta: dejarla en "vencidas" mostraba como
  // deuda del cliente algo que en realidad hay que devolverle, y arrastraba su
  // saldo negativo al subtotal del grupo.
  if (input.paymentStatus === "paid" || input.paymentStatus === "overpaid") return "paid"
  // La disputa manda: insistir con el cobro sin resolverla es contraproducente.
  if (input.collectionStatus === "disputed") return "disputed"
  if (input.collectionStatus === "committed") return "committed"
  if (input.daysOverdue !== null && input.daysOverdue > 0) return "overdue"
  if (input.paymentStatus === "partial") return "partial"
  if (input.daysOverdue !== null && input.daysOverdue >= -DUE_SOON_DAYS) return "due_soon"
  if (input.daysSinceLastAction !== null && input.daysSinceLastAction > STALE_ACTIVITY_DAYS) {
    return "no_recent_activity"
  }
  return "pending"
}

export async function getCollectionsView(session: Session | null): Promise<CollectionsView> {
  const today = todayIso()
  const scope = resolveWorksiteScope(session)

  const empty: CollectionsView = {
    today,
    rows: [],
    buckets: COLLECTION_BUCKETS.map((bucket) => ({ ...bucket, count: 0, byCurrency: [] })),
    totalOutstanding: [],
  }
  if (scope.mode === "none") return empty

  const conditions = [
    eq(billingInvoices.direction, "sale"),
    ne(billingInvoices.documentStatus, "void"),
  ]
  if (scope.mode === "some") {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${billingInvoiceLinks}
      WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoices.id}
        AND ${billingInvoiceLinks.status} = 'confirmed'
        AND ${billingInvoiceLinks.worksiteId} IN ${scope.ids}
    )`)
  }

  const invoiceRows = await db
    .select({
      invoiceId: billingInvoices.id,
      docType: billingInvoices.docType,
      folio: billingInvoices.folio,
      clientName: billingInvoices.receiverName,
      clientTaxId: billingInvoices.receiverTaxId,
      issueDate: billingInvoices.issueDate,
      dueDate: billingInvoices.dueDate,
      currency: billingInvoices.currency,
      totalAmount: billingInvoices.totalAmount,
      paidAmount: billingInvoices.paidAmount,
      paymentStatus: billingInvoices.paymentStatus,
      collectionStatus: billingInvoices.collectionStatus,
      ownerName: users.name,
    })
    .from(billingInvoices)
    .leftJoin(users, eq(users.id, billingInvoices.ownerUserId))
    .where(and(...conditions))
    .orderBy(desc(billingInvoices.dueDate))
    .limit(500)

  if (invoiceRows.length === 0) return empty

  const invoiceIds = invoiceRows.map((row) => row.invoiceId)

  const [actionRows, linkRows, suggestionRows] = await Promise.all([
    db.select({
      invoiceId: billingCollectionActions.invoiceId,
      actionDate: billingCollectionActions.actionDate,
      actionType: billingCollectionActions.actionType,
      commitmentDate: billingCollectionActions.commitmentDate,
    })
      .from(billingCollectionActions)
      .where(inArray(billingCollectionActions.invoiceId, invoiceIds))
      .orderBy(desc(billingCollectionActions.actionDate)),
    db.select({
      invoiceId: billingInvoiceLinks.invoiceId,
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
        eq(billingInvoiceLinks.status, "confirmed"),
      )),
    db.select({
      invoiceId: billingInvoicePayments.invoiceId,
      count: sql<number>`count(*)::int`,
    })
      .from(billingInvoicePayments)
      .where(and(
        inArray(billingInvoicePayments.invoiceId, invoiceIds),
        eq(billingInvoicePayments.verificationStatus, "suggested"),
      ))
      .groupBy(billingInvoicePayments.invoiceId),
  ])

  // La primera acción de cada factura es la más reciente (orden descendente).
  const lastActionByInvoice = new Map<string, typeof actionRows[number]>()
  for (const action of actionRows) {
    if (!lastActionByInvoice.has(action.invoiceId)) lastActionByInvoice.set(action.invoiceId, action)
  }
  const commitmentByInvoice = new Map<string, string>()
  for (const action of actionRows) {
    if (action.commitmentDate && !commitmentByInvoice.has(action.invoiceId)) {
      commitmentByInvoice.set(action.invoiceId, action.commitmentDate)
    }
  }
  const contextByInvoice = new Map(linkRows.map((row) => [row.invoiceId, row]))
  const suggestionsByInvoice = new Map(suggestionRows.map((row) => [row.invoiceId, row.count]))

  const rows: CollectionRow[] = invoiceRows.map((row) => {
    const overdue = row.dueDate ? daysOverdue(row.dueDate, today) : null
    const lastAction = lastActionByInvoice.get(row.invoiceId)
    const daysSinceLastAction = lastAction
      ? daysOverdue(lastAction.actionDate, today)
      // Sin gestión registrada, la antigüedad se mide desde la emisión.
      : daysOverdue(row.issueDate, today)
    const context = contextByInvoice.get(row.invoiceId)

    return {
      invoiceId: row.invoiceId,
      docType: row.docType,
      folio: row.folio,
      clientName: context?.clientName ?? row.clientName,
      clientTaxId: row.clientTaxId,
      contractCode: context?.contractCode ?? null,
      worksiteName: context?.worksiteName ?? null,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      currency: row.currency,
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount,
      outstandingAmount: outstandingAmountFor(row.totalAmount, row.paidAmount),
      paymentStatus: row.paymentStatus,
      collectionStatus: row.collectionStatus,
      daysOverdue: overdue,
      agingBucket: overdue === null || row.paymentStatus === "paid" || row.paymentStatus === "overpaid"
        ? null
        : agingBucketFor(overdue),
      bucket: classifyCollection({
        paymentStatus: row.paymentStatus,
        collectionStatus: row.collectionStatus,
        daysOverdue: overdue,
        daysSinceLastAction,
      }),
      ownerName: row.ownerName,
      lastActionDate: lastAction?.actionDate ?? null,
      lastActionType: lastAction?.actionType ?? null,
      daysSinceLastAction: lastAction ? daysSinceLastAction : null,
      commitmentDate: commitmentByInvoice.get(row.invoiceId) ?? null,
      suggestedPayments: suggestionsByInvoice.get(row.invoiceId) ?? 0,
    }
  })

  const buckets = COLLECTION_BUCKETS.map((bucket) => {
    const inBucket = rows.filter((row) => row.bucket === bucket.id)
    return {
      ...bucket,
      count: inBucket.length,
      byCurrency: sumByCurrency(inBucket.map((row) => ({ currency: row.currency, amount: row.outstandingAmount }))),
    }
  })

  return {
    today,
    rows,
    buckets,
    totalOutstanding: sumByCurrency(
      rows
        // Una sobrepagada tenía saldo NEGATIVO e incluirla neteaba lo que sí
        // hay por cobrar (FVE-003, ya recortado en `outstandingAmountFor`). El
        // filtro se conserva porque la razón es propia: lo que corresponde
        // devolver no es un cobro pendiente y no pertenece a esta cartera.
        .filter((row) => row.paymentStatus !== "paid" && row.paymentStatus !== "overpaid")
        .map((row) => ({ currency: row.currency, amount: row.outstandingAmount })),
    ),
  }
}

/** Sugerencias de pago pendientes de decisión humana. */
export async function listPendingSuggestions(session: Session | null, limit = 50) {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []

  const conditions = [eq(billingInvoicePayments.verificationStatus, "suggested")]
  if (scope.mode === "some") {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${billingInvoiceLinks}
      WHERE ${billingInvoiceLinks.invoiceId} = ${billingInvoicePayments.invoiceId}
        AND ${billingInvoiceLinks.status} = 'confirmed'
        AND ${billingInvoiceLinks.worksiteId} IN ${scope.ids}
    )`)
  }

  return db
    .select({
      paymentId: billingInvoicePayments.id,
      invoiceId: billingInvoicePayments.invoiceId,
      folio: billingInvoices.folio,
      clientName: billingInvoices.receiverName,
      paymentDate: billingInvoicePayments.paymentDate,
      amount: billingInvoicePayments.amount,
      currency: billingInvoicePayments.currency,
      confidence: billingInvoicePayments.confidence,
      evidence: billingInvoicePayments.evidence,
      invoiceTotal: billingInvoices.totalAmount,
      invoicePaid: billingInvoices.paidAmount,
    })
    .from(billingInvoicePayments)
    .innerJoin(billingInvoices, eq(billingInvoices.id, billingInvoicePayments.invoiceId))
    .where(and(...conditions))
    .orderBy(desc(billingInvoicePayments.paymentDate))
    .limit(limit)
}
