/**
 * lib/services/billing/duplicates.ts
 *
 * Detección y resolución de duplicados **no exactos**.
 *
 * Un duplicado exacto no llega hasta acá: la identidad tributaria
 * `(direction, doc_type, folio, issuer_tax_id, receiver_tax_id)` hace que dos
 * fuentes que describen el mismo documento caigan sobre la misma fila.
 *
 * Lo que sí llega son los casos ambiguos: el mismo cobro cargado a mano y
 * después sincronizado con otro folio, una nota de crédito registrada dos veces
 * con tipos distintos, un documento reemitido. Ahí **fusionar mal pierde
 * información**, así que la plataforma marca el par y espera una decisión.
 *
 * Fusionar no borra nada: mueve las referencias, vínculos y pagos a la factura
 * superviviente y deja la otra como `void` (anulada) con un evento que explica
 * por qué. Eso la saca de toda agregación sin perder su historia, y permite
 * deshacer.
 */

import { and, eq, isNotNull, ne, or, sql, type SQL } from "drizzle-orm"
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  billingDuplicateCandidates,
  billingExternalRefs,
  billingInvoiceItems,
  billingInvoiceLinks,
  billingInvoicePayments,
  billingInvoices,
} from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { cleanRut } from "@/lib/rut"
import { absAmount, amountsWithinTolerance, compareAmounts } from "./money"
import { daysOverdue, recomputeInvoicePaymentStatus, recordInvoiceEvent } from "./invoices"
import { todayInChile } from "@/lib/utils"

export type DuplicateClassification = "probable" | "possible" | "conflict"

export interface DuplicateEvidence {
  sameCounterparty: boolean
  sameTotal: boolean
  sameIssueDate: boolean
  daysApart: number
  sameDocType: boolean
  sameFolio: boolean
  notes: string[]
}

/** Días de distancia máxima entre emisiones para considerar el par sospechoso. */
const MAX_DAYS_APART = 45
/** Tolerancia de monto para considerarlo "el mismo cobro" (CLP). */
const AMOUNT_TOLERANCE = 1000

export interface DuplicatePair {
  invoiceId: string
  otherInvoiceId: string
  classification: DuplicateClassification
  evidence: DuplicateEvidence
}

interface InvoiceRow {
  id: string
  direction: string
  docType: string
  folio: number
  issuerTaxId: string
  receiverTaxId: string
  issueDate: string
  currency: string
  totalAmount: number
  documentStatus: string
}

/**
 * Clasifica un par de facturas. Función pura: la prueba la ejercita sin base de
 * datos y la regla queda en un solo lugar.
 *
 * Devuelve `null` cuando el par no merece revisión humana.
 */
export function classifyPair(a: InvoiceRow, b: InvoiceRow): DuplicatePair | null {
  // Distinta dirección o distinta moneda: no son el mismo cobro.
  if (a.direction !== b.direction || a.currency !== b.currency) return null

  // cleanRut como defensa: la razón de ser de este motor es atrapar lo que la
  // identidad exacta no captura, y un RUT con puntos en una fuente y sin
  // puntos en otra (fuentes históricas sin normalizar) lo dejaba ciego.
  const sameCounterparty = cleanRut(a.issuerTaxId) === cleanRut(b.issuerTaxId)
    && cleanRut(a.receiverTaxId) === cleanRut(b.receiverTaxId)
  if (!sameCounterparty) return null

  const sameTotal = amountsWithinTolerance(a.totalAmount, b.totalAmount, AMOUNT_TOLERANCE)
  const daysApart = Math.abs(daysOverdue(a.issueDate, b.issueDate))
  const sameIssueDate = a.issueDate === b.issueDate
  const sameDocType = a.docType === b.docType
  const sameFolio = a.folio === b.folio

  const notes: string[] = []
  if (sameTotal) notes.push("Mismo monto total entre las dos facturas")
  if (sameIssueDate) notes.push("Misma fecha de emisión")
  else if (daysApart <= MAX_DAYS_APART) notes.push(`Emitidas con ${daysApart} días de diferencia`)
  if (sameFolio && !sameDocType) notes.push("Mismo folio con distinto tipo de documento")
  if (!sameFolio) notes.push("Distinto folio")

  // Mismo folio y tipo pero montos incompatibles: no es un duplicado, es un
  // conflicto de datos que alguien tiene que mirar.
  if (sameFolio && sameDocType && !sameTotal) {
    return {
      invoiceId: a.id,
      otherInvoiceId: b.id,
      classification: "conflict",
      evidence: { sameCounterparty, sameTotal, sameIssueDate, daysApart, sameDocType, sameFolio, notes: [...notes, "Mismo documento con montos distintos"] },
    }
  }

  if (!sameTotal) return null
  if (daysApart > MAX_DAYS_APART) return null

  // Misma contraparte, mismo monto y fechas cercanas: probable si además
  // coincide la fecha exacta o el tipo; posible en el resto de los casos.
  const classification: DuplicateClassification =
    sameIssueDate || (sameDocType && daysApart <= 7) ? "probable" : "possible"

  return {
    invoiceId: a.id,
    otherInvoiceId: b.id,
    classification,
    evidence: { sameCounterparty, sameTotal, sameIssueDate, daysApart, sameDocType, sameFolio, notes },
  }
}

/**
 * Busca pares sospechosos y los registra. Idempotente: un par ya registrado
 * —abierto, fusionado o descartado— no se vuelve a crear.
 */
export async function detectDuplicateCandidates(
  options: { direction?: "sale" | "purchase"; limit?: number } = {},
): Promise<{ scanned: number; created: number; alreadyKnown: number }> {
  const direction = options.direction ?? "sale"

  const invoices = await db
    .select({
      id: billingInvoices.id,
      direction: billingInvoices.direction,
      docType: billingInvoices.docType,
      folio: billingInvoices.folio,
      issuerTaxId: billingInvoices.issuerTaxId,
      receiverTaxId: billingInvoices.receiverTaxId,
      issueDate: billingInvoices.issueDate,
      currency: billingInvoices.currency,
      totalAmount: billingInvoices.totalAmount,
      documentStatus: billingInvoices.documentStatus,
    })
    .from(billingInvoices)
    .where(and(
      eq(billingInvoices.direction, direction),
      ne(billingInvoices.documentStatus, "void"),
    ))
    .limit(options.limit ?? 1000)

  // Agrupar por contraparte antes de comparar: sin esto la comparación sería
  // cuadrática sobre todo el universo de facturas.
  const byCounterparty = new Map<string, InvoiceRow[]>()
  for (const invoice of invoices) {
    // La clave se normaliza igual que la comparación de `classifyPair`: con el
    // RUT crudo, un "76.543.210-K" y un "76543210-K" caían en grupos distintos
    // y nunca llegaban a compararse — justo el caso que esa defensa atiende.
    const key = `${cleanRut(invoice.issuerTaxId)}|${cleanRut(invoice.receiverTaxId)}|${invoice.currency}`
    const group = byCounterparty.get(key) ?? []
    group.push(invoice)
    byCounterparty.set(key, group)
  }

  let created = 0
  let alreadyKnown = 0

  for (const group of byCounterparty.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const pair = classifyPair(group[i]!, group[j]!)
        if (!pair) continue

        // Orden estable del par: evita registrar (A,B) y (B,A) como distintos.
        const [first, second] = [pair.invoiceId, pair.otherInvoiceId].sort() as [string, string]

        const existing = await db
          .select({ id: billingDuplicateCandidates.id })
          .from(billingDuplicateCandidates)
          .where(or(
            and(eq(billingDuplicateCandidates.invoiceId, first), eq(billingDuplicateCandidates.otherInvoiceId, second)),
            and(eq(billingDuplicateCandidates.invoiceId, second), eq(billingDuplicateCandidates.otherInvoiceId, first)),
          ))
          .limit(1)

        if (existing.length > 0) {
          alreadyKnown++
          continue
        }

        await db.insert(billingDuplicateCandidates).values({
          id: nanoid(),
          invoiceId: first,
          otherInvoiceId: second,
          classification: pair.classification,
          evidence: pair.evidence,
          status: "open",
        })
        created++
      }
    }
  }

  return { scanned: invoices.length, created, alreadyKnown }
}

/**
 * Candidatos abiertos, con el detalle de ambas facturas.
 *
 * Usa dos alias de la misma tabla (`alias` de Drizzle, no SQL crudo) para poder
 * mostrar lado a lado lo que dice cada una y que la decisión se tome mirando los
 * dos documentos, no un identificador.
 */
/**
 * Misma regla de alcance que `invoiceScopePredicate` (queries.ts), aplicada a
 * un alias: un rol acotado solo ve facturas con vínculo confirmado a sus
 * faenas. Sin esto, la pantalla de duplicados mostraba pares (con montos y
 * RUT) de toda la empresa a cualquier rol con billing:manage_invoices.
 */
function aliasScopePredicate(session: Session | null, invoiceAlias: { id: AnyPgColumn }): SQL | null | false {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "all") return null
  if (scope.mode === "none") return false

  return sql`EXISTS (
    SELECT 1 FROM ${billingInvoiceLinks}
    WHERE ${billingInvoiceLinks.invoiceId} = ${invoiceAlias.id}
      AND ${billingInvoiceLinks.status} = 'confirmed'
      AND ${billingInvoiceLinks.worksiteId} IN ${scope.ids}
  )`
}

export async function listOpenDuplicates(session: Session | null, limit = 50) {
  const left = alias(billingInvoices, "invoice_left")
  const right = alias(billingInvoices, "invoice_right")

  const leftScope = aliasScopePredicate(session, left)
  const rightScope = aliasScopePredicate(session, right)
  if (leftScope === false || rightScope === false) return []

  return db
    .select({
      id: billingDuplicateCandidates.id,
      classification: billingDuplicateCandidates.classification,
      evidence: billingDuplicateCandidates.evidence,
      createdAt: billingDuplicateCandidates.createdAt,
      invoiceId: billingDuplicateCandidates.invoiceId,
      otherInvoiceId: billingDuplicateCandidates.otherInvoiceId,
      counterpartyName: left.receiverName,
      currency: left.currency,
      folioA: left.folio,
      docTypeA: left.docType,
      issueDateA: left.issueDate,
      totalA: left.totalAmount,
      paidA: left.paidAmount,
      sourceA: left.source,
      receiverTaxIdA: left.receiverTaxId,
      receiverNameA: left.receiverName,
      documentStatusA: left.documentStatus,
      folioB: right.folio,
      docTypeB: right.docType,
      issueDateB: right.issueDate,
      totalB: right.totalAmount,
      paidB: right.paidAmount,
      sourceB: right.source,
      receiverTaxIdB: right.receiverTaxId,
      receiverNameB: right.receiverName,
      documentStatusB: right.documentStatus,
    })
    .from(billingDuplicateCandidates)
    .innerJoin(left, eq(left.id, billingDuplicateCandidates.invoiceId))
    .innerJoin(right, eq(right.id, billingDuplicateCandidates.otherInvoiceId))
    .where(and(
      eq(billingDuplicateCandidates.status, "open"),
      ...(leftScope ? [leftScope] : []),
      ...(rightScope ? [rightScope] : []),
    ))
    .limit(limit)
}

export class DuplicateMergeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DuplicateMergeError"
  }
}

/**
 * Fusiona dos facturas: `keepId` sobrevive, `dropId` queda anulada.
 *
 * Qué se mueve: referencias externas, vínculos operacionales, pagos e ítems
 * (estos últimos solo si la superviviente no tiene). Qué NO pasa: nada se borra.
 * La factura descartada conserva su fila, su historia y su `merged_into_id`.
 *
 * Se niega a fusionar si ambas tienen pagos confirmados: sumarlos podría
 * inventar un cobro que no existió, y esa decisión no la puede tomar el sistema.
 */
export async function mergeDuplicate(input: {
  candidateId: string
  keepId: string
  dropId: string
  actorUserId: string
}): Promise<void> {
  if (input.keepId === input.dropId) {
    throw new DuplicateMergeError("No se puede fusionar una factura consigo misma")
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: billingInvoices.id,
        folio: billingInvoices.folio,
        docType: billingInvoices.docType,
        paidAmount: billingInvoices.paidAmount,
        documentStatus: billingInvoices.documentStatus,
        currency: billingInvoices.currency,
      })
      .from(billingInvoices)
      .where(or(eq(billingInvoices.id, input.keepId), eq(billingInvoices.id, input.dropId)))

    const keep = rows.find((row) => row.id === input.keepId)
    const drop = rows.find((row) => row.id === input.dropId)
    if (!keep || !drop) throw new DuplicateMergeError("Una de las facturas no existe")
    if (keep.currency !== drop.currency) {
      throw new DuplicateMergeError("No se pueden fusionar facturas en monedas distintas")
    }
    if (compareAmounts(absAmount(keep.paidAmount), 0) > 0 && compareAmounts(absAmount(drop.paidAmount), 0) > 0) {
      throw new DuplicateMergeError(
        "Ambas facturas tienen pagos confirmados. Revierte los pagos de la que se va a descartar antes de fusionar.",
      )
    }

    // Las referencias del proveedor se mueven solo si la superviviente no tiene
    // ya una de ese mismo proveedor (el índice único lo impediría).
    const keepProviders = await tx
      .select({ provider: billingExternalRefs.provider })
      .from(billingExternalRefs)
      .where(eq(billingExternalRefs.invoiceId, input.keepId))
    const taken = new Set(keepProviders.map((row) => row.provider))

    const dropRefs = await tx
      .select({ id: billingExternalRefs.id, provider: billingExternalRefs.provider })
      .from(billingExternalRefs)
      .where(eq(billingExternalRefs.invoiceId, input.dropId))

    for (const ref of dropRefs) {
      if (taken.has(ref.provider)) continue
      await tx.update(billingExternalRefs)
        .set({ invoiceId: input.keepId })
        .where(eq(billingExternalRefs.id, ref.id))
    }

    await tx.update(billingInvoiceLinks)
      .set({ invoiceId: input.keepId })
      .where(eq(billingInvoiceLinks.invoiceId, input.dropId))

    // El índice único (invoiceId, bankTransactionId) impide que ambas facturas
    // tengan imputado el mismo movimiento — típico cuando el motor de
    // conciliación sugirió el mismo depósito a las dos candidatas. Sin este
    // chequeo, el UPDATE reventaba con el error crudo de Postgres en el toast.
    const sharedBankTx = await tx
      .select({ id: billingInvoicePayments.id })
      .from(billingInvoicePayments)
      .where(and(
        eq(billingInvoicePayments.invoiceId, input.dropId),
        isNotNull(billingInvoicePayments.bankTransactionId),
        sql`${billingInvoicePayments.bankTransactionId} IN (
          SELECT bank_transaction_id FROM ${billingInvoicePayments}
          WHERE ${billingInvoicePayments.invoiceId} = ${input.keepId}
            AND bank_transaction_id IS NOT NULL
        )`,
      ))
      .limit(1)
    if (sharedBankTx.length > 0) {
      throw new DuplicateMergeError(
        "Ambas facturas tienen una imputación del mismo movimiento bancario. Descarta o revierte esa imputación en una de las dos antes de fusionar.",
      )
    }

    await tx.update(billingInvoicePayments)
      .set({ invoiceId: input.keepId })
      .where(eq(billingInvoicePayments.invoiceId, input.dropId))

    // paid_amount/payment_status son caché derivada de los pagos: mover pagos
    // sin rederivarla deja ambas facturas con un saldo que no refleja lo que
    // acaban de recibir/perder (H-02, AUDITORIA_BUGS_2026-08-05.md). dropId
    // también se recalcula — queda `void`, pero su caché de saldo no debe
    // seguir describiendo pagos que ya no le pertenecen.
    await recomputeInvoicePaymentStatus(tx, input.keepId)
    await recomputeInvoicePaymentStatus(tx, input.dropId)

    const keepItems = await tx
      .select({ id: billingInvoiceItems.id })
      .from(billingInvoiceItems)
      .where(eq(billingInvoiceItems.invoiceId, input.keepId))
      .limit(1)
    if (keepItems.length === 0) {
      await tx.update(billingInvoiceItems)
        .set({ invoiceId: input.keepId })
        .where(eq(billingInvoiceItems.invoiceId, input.dropId))
    }

    // La descartada queda anulada: sale de toda agregación sin desaparecer.
    await tx.update(billingInvoices).set({
      documentStatus: "void",
      notes: sql`coalesce(${billingInvoices.notes} || E'\n', '') || ${`Fusionada con el documento ${keep.docType}/${keep.folio} el ${todayInChile()}.`}`,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingInvoices.id, input.dropId))

    await tx.update(billingDuplicateCandidates).set({
      status: "merged",
      mergedIntoId: input.keepId,
      resolvedBy: input.actorUserId,
      resolvedAt: new Date().toISOString(),
    }).where(eq(billingDuplicateCandidates.id, input.candidateId))

    await recordInvoiceEvent(tx, {
      invoiceId: input.keepId,
      eventType: "invoice.merged_from",
      actorKind: "user",
      actorUserId: input.actorUserId,
      detail: { mergedInvoiceId: input.dropId, folio: drop.folio, docType: drop.docType },
    })
    await recordInvoiceEvent(tx, {
      invoiceId: input.dropId,
      eventType: "invoice.merged_into",
      actorKind: "user",
      actorUserId: input.actorUserId,
      detail: { survivorInvoiceId: input.keepId, folio: keep.folio, docType: keep.docType },
    })
  })
}

/** Descarta un candidato: no son el mismo documento. No vuelve a proponerse. */
export async function dismissDuplicate(candidateId: string, actorUserId: string): Promise<void> {
  await db.update(billingDuplicateCandidates).set({
    status: "dismissed",
    resolvedBy: actorUserId,
    resolvedAt: new Date().toISOString(),
  }).where(eq(billingDuplicateCandidates.id, candidateId))
}
