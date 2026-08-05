"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  billingBankTransactions,
  billingCollectionActions,
  billingInvoiceLinks,
  billingInvoicePayments,
  billingInvoices,
} from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { recomputeInvoicePaymentStatus, recordInvoiceEvent } from "@/lib/services/billing/invoices"
import {
  assertAllocationFits,
  generatePaymentSuggestions,
  recomputeTransactionAllocation,
} from "@/lib/services/billing/reconciliation"
import type { ActionResult } from "../actions"

/* ── Gestiones de cobranza ───────────────────────────────────────────────── */

const collectionActionSchema = z.object({
  invoiceId: z.string().min(1),
  actionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  actionType: z.enum(["call", "email", "meeting", "note", "claim", "commitment", "dispute"]),
  channel: z.enum(["phone", "email", "in_person", "portal", "letter", "other"]).nullable().optional(),
  outcome: z.enum(["contacted", "no_answer", "promised_payment", "disputed", "escalated", "resolved", "other"]),
  contactName: z.string().max(160).nullable().optional(),
  commitmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  commitmentAmount: z.number().finite().nonnegative().nullable().optional(),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
})

/**
 * Registra una gestión de cobranza.
 *
 * Una gestión con compromiso de pago mueve además el estado de cobranza de la
 * factura a `committed`, y una disputa a `disputed`: son los dos casos en que la
 * gestión cambia cómo hay que mirar la factura. El resto solo se registra.
 */
export async function recordCollectionActionAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_collections")
  if (error) return error

  const parsed = collectionActionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data

  if (data.actionType === "commitment" && !data.commitmentDate) {
    return { ok: false, message: "Un compromiso de pago necesita una fecha comprometida" }
  }

  try {
    const invoice = await db.query.billingInvoices.findFirst({
      where: eq(billingInvoices.id, data.invoiceId),
      columns: { id: true, folio: true, collectionStatus: true },
    })
    if (!invoice) return { ok: false, message: "La factura no existe" }
    if (!(await canReachInvoice(session, data.invoiceId))) {
      return { ok: false, message: "No tienes acceso a esta factura" }
    }

    const actionId = nanoid()
    const now = new Date().toISOString()

    // El estado de cobranza lo mueve la gestión solo cuando corresponde. Marcar
    // "en gestión" por registrar una nota sería ruido.
    const nextCollectionStatus =
      data.actionType === "commitment" || data.outcome === "promised_payment" ? "committed"
      : data.actionType === "dispute" || data.outcome === "disputed" ? "disputed"
      : data.outcome === "resolved" ? "closed"
      : invoice.collectionStatus === "none" ? "in_progress"
      : invoice.collectionStatus

    await db.transaction(async (tx) => {
      await tx.insert(billingCollectionActions).values({
        id: actionId,
        invoiceId: data.invoiceId,
        contactName: data.contactName ?? null,
        actionDate: data.actionDate,
        actionType: data.actionType,
        channel: data.channel ?? null,
        outcome: data.outcome,
        commitmentDate: data.commitmentDate ?? null,
        commitmentAmount: data.commitmentAmount ?? null,
        nextActionDate: data.nextActionDate ?? null,
        notes: data.notes ?? null,
        assigneeUserId: data.assigneeUserId ?? session.user.id,
        createdBy: session.user.id,
      })

      if (nextCollectionStatus !== invoice.collectionStatus) {
        await tx.update(billingInvoices)
          .set({ collectionStatus: nextCollectionStatus, updatedAt: now })
          .where(eq(billingInvoices.id, data.invoiceId))
      }

      await recordInvoiceEvent(tx, {
        invoiceId: data.invoiceId,
        eventType: "collection.action_recorded",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: {
          actionType: data.actionType,
          outcome: data.outcome,
          commitmentDate: data.commitmentDate ?? null,
          collectionStatus: nextCollectionStatus,
        },
      })
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "billing_collection_action",
      entityId: actionId,
      newState: { invoiceId: data.invoiceId, actionType: data.actionType, outcome: data.outcome },
    })

    revalidatePath("/facturacion/cobranza")
    revalidatePath(`/facturacion/facturas/${data.invoiceId}`)
    return { ok: true, message: "Gestión registrada" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo registrar la gestión"
    logger.error("[billing/recordCollectionAction]", { message })
    return { ok: false, message }
  }
}

/* ── Pagos ───────────────────────────────────────────────────────────────── */

const manualPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  amount: z.number().finite().refine((value) => value !== 0, "El monto no puede ser cero"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  method: z.string().max(60).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
})

/**
 * Registra un pago a mano y lo deja **confirmado**: lo está afirmando una
 * persona con `billing:confirm_payments`, que es exactamente el acto que el
 * motor automático no puede hacer por sí solo.
 */
export async function registerManualPaymentAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:confirm_payments")
  if (error) return error

  const parsed = manualPaymentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data

  try {
    const invoice = await db.query.billingInvoices.findFirst({
      where: eq(billingInvoices.id, data.invoiceId),
      columns: { id: true, folio: true, currency: true },
    })
    if (!invoice) return { ok: false, message: "La factura no existe" }
    if (invoice.currency !== data.currency) {
      return { ok: false, message: `La factura está en ${invoice.currency}: no se puede imputar un pago en ${data.currency}` }
    }
    if (!(await canReachInvoice(session, data.invoiceId))) {
      return { ok: false, message: "No tienes acceso a esta factura" }
    }

    const paymentId = nanoid()
    const now = new Date().toISOString()

    const snapshot = await db.transaction(async (tx) => {
      await tx.insert(billingInvoicePayments).values({
        id: paymentId,
        invoiceId: data.invoiceId,
        paymentDate: data.paymentDate,
        amount: data.amount,
        currency: data.currency,
        method: data.method ?? null,
        source: "manual",
        verificationStatus: "confirmed",
        matchedBy: "user",
        confirmedBy: session.user.id,
        confirmedAt: now,
        notes: data.notes ?? null,
        createdBy: session.user.id,
      })

      await recordInvoiceEvent(tx, {
        invoiceId: data.invoiceId,
        eventType: "payment.confirmed",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: { amount: data.amount, currency: data.currency, source: "manual" },
      })

      return recomputeInvoicePaymentStatus(tx, data.invoiceId)
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "billing_invoice_payment",
      entityId: paymentId,
      newState: { invoiceId: data.invoiceId, amount: data.amount, currency: data.currency, status: "confirmed" },
    })

    revalidatePath("/facturacion/cobranza")
    revalidatePath(`/facturacion/facturas/${data.invoiceId}`)
    revalidatePath("/facturacion")
    return { ok: true, message: `Pago registrado. La factura queda ${PAYMENT_STATUS_TEXT[snapshot.paymentStatus]}.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo registrar el pago"
    logger.error("[billing/registerManualPayment]", { message })
    return { ok: false, message }
  }
}

const PAYMENT_STATUS_TEXT: Record<string, string> = {
  unpaid:   "pendiente de pago",
  partial:  "con pago parcial",
  paid:     "pagada",
  overpaid: "pagada de más (revisar)",
}

const resolveSuggestionSchema = z.object({
  paymentId: z.string().min(1),
  decision: z.enum(["confirm", "reject"]),
  reason: z.string().max(500).nullable().optional(),
  /** Permite confirmar un monto distinto al sugerido (pago parcial acordado). */
  amount: z.number().finite().positive().nullable().optional(),
})

/**
 * Confirma o descarta una sugerencia de pago.
 *
 * Es **el único camino** por el que una sugerencia se convierte en cobro. La
 * acción verifica que el movimiento bancario tenga saldo disponible antes de
 * imputar: un mismo movimiento repartido entre varias facturas es válido,
 * sobregirarlo no.
 */
export async function resolvePaymentSuggestionAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:confirm_payments")
  if (error) return error

  const parsed = resolveSuggestionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const { paymentId, decision, reason, amount } = parsed.data

  try {
    const payment = await db.query.billingInvoicePayments.findFirst({
      where: and(
        eq(billingInvoicePayments.id, paymentId),
        eq(billingInvoicePayments.verificationStatus, "suggested"),
      ),
      columns: {
        id: true, invoiceId: true, bankTransactionId: true, amount: true, currency: true,
      },
    })
    if (!payment) return { ok: false, message: "La sugerencia no existe o ya fue resuelta" }
    if (!(await canReachInvoice(session, payment.invoiceId))) {
      return { ok: false, message: "No tienes acceso a esta factura" }
    }

    const now = new Date().toISOString()

    if (decision === "reject") {
      await db.transaction(async (tx) => {
        await tx.update(billingInvoicePayments).set({
          verificationStatus: "rejected",
          rejectedBy: session.user.id,
          rejectedAt: now,
          rejectionReason: reason ?? null,
          updatedAt: now,
        }).where(eq(billingInvoicePayments.id, paymentId))

        await recordInvoiceEvent(tx, {
          invoiceId: payment.invoiceId,
          eventType: "payment.rejected",
          actorKind: "user",
          actorUserId: session.user.id,
          detail: { paymentId, reason: reason ?? null },
        })
      })

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "billing_invoice_payment",
        entityId: paymentId,
        oldState: { status: "suggested" },
        newState: { status: "rejected" },
        reason: reason ?? undefined,
      })

      revalidatePath("/facturacion/cobranza")
      revalidatePath(`/facturacion/facturas/${payment.invoiceId}`)
      return { ok: true, message: "Sugerencia descartada. No se volverá a proponer." }
    }

    const finalAmount = amount ?? payment.amount

    const snapshot = await db.transaction(async (tx) => {
      if (payment.bankTransactionId) {
        const transaction = await tx.query.billingBankTransactions.findFirst({
          where: eq(billingBankTransactions.id, payment.bankTransactionId),
          columns: { id: true, amount: true, allocatedAmount: true },
        })
        if (!transaction) throw new Error("El movimiento bancario ya no existe")
        assertAllocationFits(transaction.amount, transaction.allocatedAmount, finalAmount)
      }

      await tx.update(billingInvoicePayments).set({
        verificationStatus: "confirmed",
        amount: finalAmount,
        confirmedBy: session.user.id,
        confirmedAt: now,
        updatedAt: now,
      }).where(eq(billingInvoicePayments.id, paymentId))

      await recordInvoiceEvent(tx, {
        invoiceId: payment.invoiceId,
        eventType: "payment.confirmed",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: { paymentId, amount: finalAmount, currency: payment.currency },
      })

      if (payment.bankTransactionId) {
        await recomputeTransactionAllocation(tx, payment.bankTransactionId)
      }
      return recomputeInvoicePaymentStatus(tx, payment.invoiceId)
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_invoice_payment",
      entityId: paymentId,
      oldState: { status: "suggested", amount: payment.amount },
      newState: { status: "confirmed", amount: finalAmount },
    })

    revalidatePath("/facturacion/cobranza")
    revalidatePath(`/facturacion/facturas/${payment.invoiceId}`)
    revalidatePath("/facturacion")
    return { ok: true, message: `Pago confirmado. La factura queda ${PAYMENT_STATUS_TEXT[snapshot.paymentStatus]}.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo resolver la sugerencia"
    logger.error("[billing/resolveSuggestion]", { message })
    return { ok: false, message }
  }
}

/**
 * Revierte un pago confirmado.
 *
 * Existe porque confirmar es humano y equivocarse también. Queda registrado
 * quién revirtió y por qué; el pago no se borra, se marca descartado.
 */
export async function revertPaymentAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:confirm_payments")
  if (error) return error

  const parsed = z.object({
    paymentId: z.string().min(1),
    reason: z.string().min(3, "Indica el motivo de la reversión").max(500),
  }).safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }

  try {
    const payment = await db.query.billingInvoicePayments.findFirst({
      where: and(
        eq(billingInvoicePayments.id, parsed.data.paymentId),
        eq(billingInvoicePayments.verificationStatus, "confirmed"),
      ),
      columns: { id: true, invoiceId: true, bankTransactionId: true, amount: true },
    })
    if (!payment) return { ok: false, message: "El pago no existe o no está confirmado" }
    if (!(await canReachInvoice(session, payment.invoiceId))) {
      return { ok: false, message: "No tienes acceso a esta factura" }
    }

    const now = new Date().toISOString()
    const snapshot = await db.transaction(async (tx) => {
      await tx.update(billingInvoicePayments).set({
        verificationStatus: "rejected",
        rejectedBy: session.user.id,
        rejectedAt: now,
        rejectionReason: parsed.data.reason,
        confirmedBy: null,
        confirmedAt: null,
        updatedAt: now,
      }).where(eq(billingInvoicePayments.id, payment.id))

      await recordInvoiceEvent(tx, {
        invoiceId: payment.invoiceId,
        eventType: "payment.reverted",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: { paymentId: payment.id, amount: payment.amount, reason: parsed.data.reason },
      })

      if (payment.bankTransactionId) {
        await recomputeTransactionAllocation(tx, payment.bankTransactionId)
      }
      return recomputeInvoicePaymentStatus(tx, payment.invoiceId)
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_invoice_payment",
      entityId: payment.id,
      oldState: { status: "confirmed" },
      newState: { status: "rejected" },
      reason: parsed.data.reason,
    })

    revalidatePath("/facturacion/cobranza")
    revalidatePath(`/facturacion/facturas/${payment.invoiceId}`)
    revalidatePath("/facturacion")
    return { ok: true, message: `Pago revertido. La factura queda ${PAYMENT_STATUS_TEXT[snapshot.paymentStatus]}.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo revertir el pago"
    logger.error("[billing/revertPayment]", { message })
    return { ok: false, message }
  }
}

/** Genera sugerencias de conciliación. No confirma ninguna. */
export async function generateSuggestionsAction(): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:confirm_payments")
  if (error) return error

  try {
    const result = await generatePaymentSuggestions({ direction: "sale" })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "billing_reconciliation_run",
      entityId: new Date().toISOString(),
      newState: { ...result },
    })

    revalidatePath("/facturacion/cobranza")

    if (result.transactionsConsidered === 0) {
      return {
        ok: true,
        message: "No hay movimientos bancarios cargados todavía. La conciliación necesita una fuente financiera (Chipax o carga manual).",
      }
    }
    return {
      ok: true,
      message: `${result.suggestionsCreated} sugerencias nuevas sobre ${result.invoicesConsidered} facturas abiertas y ${result.transactionsConsidered} movimientos. Ninguna se confirma sola.`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudieron generar sugerencias"
    logger.error("[billing/generateSuggestions]", { message })
    return { ok: false, message }
  }
}

/* ── Alcance ─────────────────────────────────────────────────────────────── */

/**
 * ¿La sesión alcanza esta factura?
 *
 * Repite la regla de `queries.ts` a propósito: una acción de escritura no puede
 * confiar en que la pantalla filtró bien. Un rol acotado por faena solo llega a
 * facturas con vínculo confirmado a sus faenas.
 */
async function canReachInvoice(
  session: Parameters<typeof resolveWorksiteScope>[0],
  invoiceId: string,
): Promise<boolean> {
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
