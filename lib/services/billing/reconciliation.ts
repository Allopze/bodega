/**
 * lib/services/billing/reconciliation.ts
 *
 * Motor de sugerencias de pago.
 *
 * ## La regla que gobierna todo este archivo
 *
 * **Una coincidencia de monto no es un pago.** El motor propone; una persona con
 * `billing:confirm_payments` decide. Nada de lo que se genera acá mueve el saldo
 * de una factura: las sugerencias nacen `suggested` y solo cuentan como cobrado
 * cuando alguien las confirma.
 *
 * ## Cómo puntúa
 *
 * Cada sugerencia acumula evidencia y de ahí sale la confianza:
 *
 * - **alta**: el RUT de la contraparte coincide Y el monto calza dentro de la
 *   tolerancia. O bien la glosa del movimiento contiene el folio de la factura.
 * - **media**: coincide el monto y la fecha cae en la ventana, pero el RUT no
 *   viene informado.
 * - **baja**: solo coincide el monto, o el nombre se parece.
 *
 * Nunca se genera una sugerencia sin al menos una coincidencia fuerte (monto
 * dentro de tolerancia o folio en la glosa). Un movimiento que solo comparte
 * fecha con una factura no es evidencia de nada.
 */

import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { billingBankTransactions, billingInvoicePayments, billingInvoices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanRut } from "@/lib/rut"
import { readReconciliationConfig } from "./config"
import { absAmount, addAmounts, amountsWithinTolerance, compareAmounts, sumAmounts } from "./money"
import { daysOverdue, recomputeInvoicePaymentStatus, recordInvoiceEvent, type PaymentStatusSnapshot } from "./invoices"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type MatchConfidence = "high" | "medium" | "low"

export interface ReconciliationCandidate {
  invoiceId: string
  bankTransactionId: string
  /** Monto que se propone imputar. */
  matchedAmount: number
  /** Saldo que quedaría en la factura si se confirma. */
  remainingAmount: number
  currency: string
  confidence: MatchConfidence
  /** Hechos concretos que sustentan la propuesta. */
  evidence: string[]
  /** Motivos para desconfiar, si los hay. */
  warnings: string[]
}

export interface InvoiceForMatching {
  id: string
  folio: number
  counterpartyTaxId: string
  counterpartyName: string
  issueDate: string
  dueDate: string | null
  currency: string
  totalAmount: number
  paidAmount: number
}

export interface TransactionForMatching {
  id: string
  transactionDate: string
  amount: number
  currency: string
  description: string | null
  counterpartyName: string | null
  counterpartyTaxId: string | null
  allocatedAmount: number
}

/**
 * Propone imputaciones entre movimientos bancarios y facturas abiertas.
 *
 * Función pura: recibe los datos y devuelve candidatos. Eso permite probarla sin
 * base de datos y, sobre todo, razonar sobre sus reglas sin perseguir consultas.
 */
export function proposeMatches(
  invoices: readonly InvoiceForMatching[],
  transactions: readonly TransactionForMatching[],
  options: { amountTolerance: number; dateWindowDays: number },
): ReconciliationCandidate[] {
  const candidates: ReconciliationCandidate[] = []

  for (const transaction of transactions) {
    const available = addAmounts(transaction.amount, -transaction.allocatedAmount)
    // Un movimiento ya imputado por completo no propone nada más.
    if (compareAmounts(absAmount(available), 0) === 0) continue

    for (const invoice of invoices) {
      // Nunca se cruzan monedas distintas: no hay tipo de cambio que inventar.
      if (invoice.currency !== transaction.currency) continue

      const outstanding = addAmounts(invoice.totalAmount, -invoice.paidAmount)
      if (compareAmounts(absAmount(outstanding), 0) === 0) continue

      const evidence: string[] = []
      const warnings: string[] = []

      // ── Evidencia fuerte 1: el folio aparece en la glosa ──────────────────
      const folioInDescription = mentionsFolio(transaction.description, invoice.folio)
      if (folioInDescription) {
        evidence.push(`La glosa del movimiento menciona el folio ${invoice.folio}`)
      }

      // ── Evidencia fuerte 2: el monto calza ────────────────────────────────
      const exactAmount = amountsWithinTolerance(absAmount(available), absAmount(outstanding), options.amountTolerance)
      if (exactAmount) {
        evidence.push("El monto disponible del movimiento calza con el saldo de la factura")
      }

      // Sin ninguna evidencia fuerte no hay sugerencia. Compartir fecha o
      // cliente no basta: eso describe a media cartola.
      if (!folioInDescription && !exactAmount) continue

      // ── Evidencia de apoyo ────────────────────────────────────────────────
      const sameTaxId =
        Boolean(transaction.counterpartyTaxId) &&
        cleanRut(transaction.counterpartyTaxId!) === cleanRut(invoice.counterpartyTaxId)
      if (sameTaxId) {
        evidence.push("El RUT de la contraparte del movimiento coincide con el de la factura")
      } else if (transaction.counterpartyTaxId) {
        warnings.push("El RUT de la contraparte no coincide con el de la factura")
      } else if (namesLookAlike(transaction.counterpartyName, invoice.counterpartyName)) {
        evidence.push("El nombre de la contraparte se parece al del cliente")
      }

      const reference = invoice.dueDate ?? invoice.issueDate
      const distance = Math.abs(daysOverdue(reference, transaction.transactionDate))
      if (distance <= options.dateWindowDays) {
        evidence.push(`La fecha del movimiento está a ${distance} días del vencimiento de la factura`)
      } else {
        warnings.push(`El movimiento está a ${distance} días del vencimiento: fuera de la ventana habitual`)
      }

      if (transaction.transactionDate < invoice.issueDate) {
        warnings.push("El movimiento es anterior a la emisión de la factura")
      }

      // ── Confianza ─────────────────────────────────────────────────────────
      let confidence: MatchConfidence = "low"
      if (folioInDescription && (sameTaxId || exactAmount)) confidence = "high"
      else if (exactAmount && sameTaxId) confidence = "high"
      else if (exactAmount && distance <= options.dateWindowDays) confidence = "medium"
      else if (folioInDescription) confidence = "medium"

      if (warnings.length > 0 && confidence === "high") confidence = "medium"

      // El monto propuesto nunca supera ni el saldo de la factura ni lo que
      // queda disponible del movimiento: un pago parcial es un resultado válido.
      const matchedAmount = compareAmounts(absAmount(available), absAmount(outstanding)) < 0
        ? available
        : outstanding

      candidates.push({
        invoiceId: invoice.id,
        bankTransactionId: transaction.id,
        matchedAmount,
        remainingAmount: addAmounts(outstanding, -matchedAmount),
        currency: invoice.currency,
        confidence,
        evidence,
        warnings,
      })
    }
  }

  // Primero lo más confiable; a igual confianza, el saldo remanente más chico
  // (la imputación que deja la factura más cerca de cerrarse).
  const order: Record<MatchConfidence, number> = { high: 0, medium: 1, low: 2 }
  return candidates.sort((a, b) =>
    order[a.confidence] - order[b.confidence] ||
    absAmount(a.remainingAmount) - absAmount(b.remainingAmount),
  )
}

/** ¿La glosa menciona el folio como número separado (no como parte de otro)? */
export function mentionsFolio(description: string | null, folio: number): boolean {
  if (!description) return false
  // El folio tiene que aparecer delimitado: "fact 1234" sí, "51234" no.
  return new RegExp(`(^|\\D)${folio}(\\D|$)`).test(description)
}

/** Comparación laxa de nombres: sin tildes, sin sufijos societarios, sin ruido. */
export function namesLookAlike(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\b(S\.?A\.?|SPA|LTDA|LIMITADA|EIRL|E\.?I\.?R\.?L\.?|Y CIA|CIA)\b/g, "")
      .replace(/[^A-Z0-9]/g, "")
  const left = normalize(a)
  const right = normalize(b)
  if (left.length < 4 || right.length < 4) return false
  return left.includes(right) || right.includes(left)
}

/* ── Persistencia de sugerencias ─────────────────────────────────────────── */

export interface SuggestionRunResult {
  invoicesConsidered: number
  transactionsConsidered: number
  suggestionsCreated: number
  suggestionsSkipped: number
}

/**
 * Genera y persiste sugerencias para las facturas abiertas.
 *
 * Idempotente: si ya existe una imputación (sugerida, confirmada o descartada)
 * entre esa factura y ese movimiento, no se vuelve a crear. Una sugerencia
 * rechazada **no reaparece**: descartar es una decisión que se respeta.
 */
export async function generatePaymentSuggestions(
  options: { direction?: "sale" | "purchase"; limit?: number } = {},
): Promise<SuggestionRunResult> {
  const direction = options.direction ?? "sale"
  const config = readReconciliationConfig()

  const invoiceRows = await db
    .select({
      id: billingInvoices.id,
      folio: billingInvoices.folio,
      issuerTaxId: billingInvoices.issuerTaxId,
      issuerName: billingInvoices.issuerName,
      receiverTaxId: billingInvoices.receiverTaxId,
      receiverName: billingInvoices.receiverName,
      issueDate: billingInvoices.issueDate,
      dueDate: billingInvoices.dueDate,
      currency: billingInvoices.currency,
      totalAmount: billingInvoices.totalAmount,
      paidAmount: billingInvoices.paidAmount,
    })
    .from(billingInvoices)
    .where(and(
      eq(billingInvoices.direction, direction),
      ne(billingInvoices.documentStatus, "void"),
      ne(billingInvoices.paymentStatus, "paid"),
    ))
    .limit(options.limit ?? 500)

  const transactionRows = await db
    .select({
      id: billingBankTransactions.id,
      transactionDate: billingBankTransactions.transactionDate,
      amount: billingBankTransactions.amount,
      currency: billingBankTransactions.currency,
      description: billingBankTransactions.description,
      counterpartyName: billingBankTransactions.counterpartyName,
      counterpartyTaxId: billingBankTransactions.counterpartyTaxId,
      allocatedAmount: billingBankTransactions.allocatedAmount,
    })
    .from(billingBankTransactions)
    .where(sql`${billingBankTransactions.amount} <> ${billingBankTransactions.allocatedAmount}`)
    .limit(options.limit ?? 500)

  const invoices: InvoiceForMatching[] = invoiceRows.map((row) => ({
    id: row.id,
    folio: row.folio,
    // En una venta la contraparte es el receptor; en una compra, el emisor.
    counterpartyTaxId: direction === "sale" ? row.receiverTaxId : row.issuerTaxId,
    counterpartyName: direction === "sale" ? row.receiverName : row.issuerName,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    totalAmount: row.totalAmount,
    paidAmount: row.paidAmount,
  }))

  const candidates = proposeMatches(invoices, transactionRows, {
    amountTolerance: config.amountToleranceClp,
    dateWindowDays: config.dateWindowDays,
  })

  let created = 0
  let skipped = 0

  for (const candidate of candidates) {
    // Una imputación previa entre este par bloquea la sugerencia — salvo que
    // sea `reverted`: descartar (`rejected`) es una decisión sobre el vínculo
    // y se respeta para siempre; revertir es corregir un error de dedo y el
    // par vuelve a ser proponible (H-15, AUDITORIA_BUGS_2026-08-05.md).
    const existing = await db
      .select({ id: billingInvoicePayments.id, verificationStatus: billingInvoicePayments.verificationStatus })
      .from(billingInvoicePayments)
      .where(and(
        eq(billingInvoicePayments.invoiceId, candidate.invoiceId),
        eq(billingInvoicePayments.bankTransactionId, candidate.bankTransactionId),
      ))
      .limit(1)

    const previous = existing[0]
    if (previous && previous.verificationStatus !== "reverted") {
      skipped++
      continue
    }

    const transaction = transactionRows.find((row) => row.id === candidate.bankTransactionId)!

    // El índice único (factura, movimiento) impide insertar una fila nueva
    // para el mismo par: la reversión se reactiva en su lugar, conservando su
    // historia (quién revirtió y por qué) en las columnas de rechazo.
    if (previous) {
      await db.transaction(async (tx) => {
        await tx.update(billingInvoicePayments).set({
          verificationStatus: "suggested",
          paymentDate: transaction.transactionDate,
          amount: candidate.matchedAmount,
          currency: candidate.currency,
          confidence: candidate.confidence,
          matchedBy: "auto",
          evidence: { evidence: candidate.evidence, warnings: candidate.warnings },
          updatedAt: new Date().toISOString(),
        }).where(eq(billingInvoicePayments.id, previous.id))

        await recordInvoiceEvent(tx, {
          invoiceId: candidate.invoiceId,
          eventType: "payment.suggested",
          actorKind: "system",
          detail: {
            confidence: candidate.confidence,
            matchedAmount: candidate.matchedAmount,
            evidence: candidate.evidence,
            reactivatedFrom: "reverted",
          },
        })
      })
      created++
      continue
    }
    await db.transaction(async (tx) => {
      await tx.insert(billingInvoicePayments).values({
        id: nanoid(),
        invoiceId: candidate.invoiceId,
        bankTransactionId: candidate.bankTransactionId,
        paymentDate: transaction.transactionDate,
        amount: candidate.matchedAmount,
        currency: candidate.currency,
        source: "manual",
        verificationStatus: "suggested",
        confidence: candidate.confidence,
        matchedBy: "auto",
        evidence: { evidence: candidate.evidence, warnings: candidate.warnings },
      })

      await recordInvoiceEvent(tx, {
        invoiceId: candidate.invoiceId,
        eventType: "payment.suggested",
        actorKind: "system",
        detail: {
          confidence: candidate.confidence,
          matchedAmount: candidate.matchedAmount,
          evidence: candidate.evidence,
        },
      })
    })
    created++
  }

  return {
    invoicesConsidered: invoices.length,
    transactionsConsidered: transactionRows.length,
    suggestionsCreated: created,
    suggestionsSkipped: skipped,
  }
}

/* ── Imputación de movimientos ───────────────────────────────────────────── */

/**
 * Recalcula cuánto de un movimiento bancario está imputado por pagos
 * **confirmados**. Se llama después de confirmar o revertir una imputación.
 */
export async function recomputeTransactionAllocation(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  bankTransactionId: string,
): Promise<number> {
  const payments = await executor
    .select({ amount: billingInvoicePayments.amount })
    .from(billingInvoicePayments)
    .where(and(
      eq(billingInvoicePayments.bankTransactionId, bankTransactionId),
      eq(billingInvoicePayments.verificationStatus, "confirmed"),
    ))

  const allocated = sumAmounts(payments.map((row) => row.amount))
  await executor
    .update(billingBankTransactions)
    .set({ allocatedAmount: allocated })
    .where(eq(billingBankTransactions.id, bankTransactionId))

  return allocated
}

/**
 * Verifica que confirmar `amount` no sobrepase lo disponible del movimiento.
 * Un movimiento repartido entre varias facturas es válido; sobregirarlo no.
 */
export function assertAllocationFits(
  transactionAmount: number,
  alreadyAllocated: number,
  newAmount: number,
): void {
  const available = addAmounts(absAmount(transactionAmount), -absAmount(alreadyAllocated))
  if (compareAmounts(absAmount(newAmount), available) > 0) {
    throw new Error(
      `El movimiento solo tiene ${available.toLocaleString("es-CL")} disponibles y se intenta imputar ${absAmount(newAmount).toLocaleString("es-CL")}`,
    )
  }
}

/**
 * Bloquea la fila del movimiento bancario dentro de la transacción del
 * llamador. Es el punto de serialización: cualquier escritura que después
 * toque `billing_invoice_payments` para este movimiento y llame a
 * `recomputeTransactionAllocation` tiene que pasar primero por acá — sin el
 * lock, dos confirmaciones (o una confirmación y una reversión) concurrentes
 * sobre el mismo movimiento pueden leer el mismo `allocatedAmount`, pasar
 * ambas la validación, y la última en escribir pisa el saldo real de la otra
 * (H-01, AUDITORIA_BUGS_2026-08-05.md).
 */
async function lockBankTransaction(
  tx: Tx,
  bankTransactionId: string,
): Promise<{ id: string; amount: number; allocatedAmount: number }> {
  const [transaction] = await tx
    .select({
      id: billingBankTransactions.id,
      amount: billingBankTransactions.amount,
      allocatedAmount: billingBankTransactions.allocatedAmount,
    })
    .from(billingBankTransactions)
    .where(eq(billingBankTransactions.id, bankTransactionId))
    .for("update")
  if (!transaction) throw new Error("El movimiento bancario ya no existe")
  return transaction
}

export interface ConfirmPaymentSuggestionInput {
  paymentId: string
  bankTransactionId: string | null
  finalAmount: number
  actorUserId: string
  now: string
}

export type ConfirmPaymentSuggestionResult = PaymentStatusSnapshot & { invoiceId: string }

/**
 * Confirma una sugerencia de pago dentro de la transacción del llamador,
 * serializada contra cualquier otra confirmación/reversión del mismo
 * movimiento bancario. Es el único camino correcto para pasar un pago de
 * `suggested` a `confirmed` — `resolvePaymentSuggestionAction` es un wrapper
 * fino sobre esta función.
 */
export async function confirmPaymentSuggestion(
  tx: Tx,
  input: ConfirmPaymentSuggestionInput,
): Promise<ConfirmPaymentSuggestionResult> {
  if (input.bankTransactionId) {
    const transaction = await lockBankTransaction(tx, input.bankTransactionId)
    assertAllocationFits(transaction.amount, transaction.allocatedAmount, input.finalAmount)
  }

  const [updated] = await tx
    .update(billingInvoicePayments)
    .set({
      verificationStatus: "confirmed",
      amount: input.finalAmount,
      confirmedBy: input.actorUserId,
      confirmedAt: input.now,
      updatedAt: input.now,
    })
    .where(and(
      eq(billingInvoicePayments.id, input.paymentId),
      eq(billingInvoicePayments.verificationStatus, "suggested"),
    ))
    .returning({ id: billingInvoicePayments.id, invoiceId: billingInvoicePayments.invoiceId })

  if (!updated) throw new Error("La sugerencia ya fue resuelta por otra persona")

  await recordInvoiceEvent(tx, {
    invoiceId: updated.invoiceId,
    eventType: "payment.confirmed",
    actorKind: "user",
    actorUserId: input.actorUserId,
    detail: { paymentId: input.paymentId, amount: input.finalAmount },
  })

  if (input.bankTransactionId) await recomputeTransactionAllocation(tx, input.bankTransactionId)
  const snapshot = await recomputeInvoicePaymentStatus(tx, updated.invoiceId)
  return { ...snapshot, invoiceId: updated.invoiceId }
}

export interface RevertConfirmedPaymentInput {
  paymentId: string
  bankTransactionId: string | null
  reason: string
  actorUserId: string
  now: string
}

export type RevertConfirmedPaymentResult = PaymentStatusSnapshot & { invoiceId: string; amount: number }

/**
 * Revierte un pago confirmado dentro de la transacción del llamador, con el
 * mismo lock del movimiento bancario que `confirmPaymentSuggestion` — la
 * reversión también recalcula `allocated_amount` y necesita el mismo punto de
 * serialización para no pisarse con una confirmación concurrente.
 */
export async function revertConfirmedPayment(
  tx: Tx,
  input: RevertConfirmedPaymentInput,
): Promise<RevertConfirmedPaymentResult> {
  if (input.bankTransactionId) {
    await lockBankTransaction(tx, input.bankTransactionId)
  }

  const [updated] = await tx
    .update(billingInvoicePayments)
    .set({
      // `reverted`, no `rejected`: revertir corrige un error de dedo, no
      // descarta el vínculo. Marcarlo `rejected` lo excluía para siempre del
      // motor de sugerencias (H-15, AUDITORIA_BUGS_2026-08-05.md).
      verificationStatus: "reverted",
      rejectedBy: input.actorUserId,
      rejectedAt: input.now,
      rejectionReason: input.reason,
      confirmedBy: null,
      confirmedAt: null,
      updatedAt: input.now,
    })
    .where(and(
      eq(billingInvoicePayments.id, input.paymentId),
      eq(billingInvoicePayments.verificationStatus, "confirmed"),
    ))
    .returning({ id: billingInvoicePayments.id, invoiceId: billingInvoicePayments.invoiceId, amount: billingInvoicePayments.amount })

  if (!updated) throw new Error("El pago ya no está confirmado — posible concurrencia")

  await recordInvoiceEvent(tx, {
    invoiceId: updated.invoiceId,
    eventType: "payment.reverted",
    actorKind: "user",
    actorUserId: input.actorUserId,
    detail: { paymentId: input.paymentId, amount: updated.amount, reason: input.reason },
  })

  if (input.bankTransactionId) await recomputeTransactionAllocation(tx, input.bankTransactionId)
  const snapshot = await recomputeInvoicePaymentStatus(tx, updated.invoiceId)
  return { ...snapshot, invoiceId: updated.invoiceId, amount: updated.amount }
}
