"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  billingCollectionActions,
  billingInvoicePayments,
  billingInvoices,
} from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { requireDifferentActor } from "@/lib/auth/segregation"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { recomputeInvoicePaymentStatus, recordInvoiceEvent } from "@/lib/services/billing/invoices"
import {
  confirmPaymentSuggestion,
  generatePaymentSuggestions,
  revertConfirmedPayment,
} from "@/lib/services/billing/reconciliation"
import { canReachInvoice } from "@/lib/services/billing/queries"
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
    const message = safeActionMessage(err, "No se pudo registrar la gestión")
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
    // Un pago negativo es un ajuste (NC, devolución): sin explicación escrita,
    // el historial muestra un cobro que se achica sin que nadie sepa por qué.
    if (data.amount < 0 && !data.notes?.trim()) {
      return { ok: false, message: "Un pago negativo es un ajuste: explica el motivo en la nota (p. ej. nota de crédito o devolución)." }
    }

    const paymentId = nanoid()
    const now = new Date().toISOString()

    const snapshot = await db.transaction(async (tx) => {
      // El índice único (invoiceId, bankTransactionId) no cubre pagos manuales
      // (bank_tx NULL): un doble clic o doble pestaña duplicaba el cobro. El
      // lock serializa y la ventana corta atrapa el reintento accidental sin
      // impedir dos pagos reales iguales en días distintos.
      await tx.execute(sql`SELECT id FROM ${billingInvoices} WHERE id = ${data.invoiceId} FOR UPDATE`)
      const [recentTwin] = await tx
        .select({ id: billingInvoicePayments.id })
        .from(billingInvoicePayments)
        .where(and(
          eq(billingInvoicePayments.invoiceId, data.invoiceId),
          eq(billingInvoicePayments.source, "manual"),
          eq(billingInvoicePayments.amount, data.amount),
          eq(billingInvoicePayments.paymentDate, data.paymentDate),
          eq(billingInvoicePayments.verificationStatus, "confirmed"),
          sql`${billingInvoicePayments.createdAt} > now() - interval '2 minutes'`,
        ))
        .limit(1)
      if (recentTwin) {
        throw new Error("Ya se registró un pago idéntico hace un momento. Si realmente son dos pagos distintos, espera dos minutos o diferéncialos en la nota.")
      }

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
    const message = safeActionMessage(err, "No se pudo registrar el pago")
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

    // El lock de fila del movimiento bancario y el `WHERE ... status = 'suggested'`
    // viven en confirmPaymentSuggestion: dos confirmaciones concurrentes sobre el
    // mismo movimiento no pueden pisarse el saldo imputado (H-01, AUDITORIA_BUGS_2026-08-05.md).
    const snapshot = await db.transaction((tx) =>
      confirmPaymentSuggestion(tx, {
        paymentId,
        bankTransactionId: payment.bankTransactionId,
        finalAmount,
        actorUserId: session.user.id,
        now,
      }),
    )

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
    const message = safeActionMessage(err, "No se pudo resolver la sugerencia")
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
  /*
   * COB-002 (auditoría 2026-09-14), patrón P9: revertir compartía permiso con
   * registrar y confirmar, de modo que una persona podía imputar un pago
   * inexistente y deshacerlo ella misma si alguien lo notaba. Ahora son dos
   * controles distintos —el permiso y la persona—, como en las propuestas de
   * venta y en la verificación de una CAPA.
   */
  const { session, error } = await guardPermission("billing:revert_payments")
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
      columns: { id: true, invoiceId: true, bankTransactionId: true, amount: true, confirmedBy: true },
    })
    if (!payment) return { ok: false, message: "El pago no existe o no está confirmado" }
    if (!(await canReachInvoice(session, payment.invoiceId))) {
      return { ok: false, message: "No tienes acceso a esta factura" }
    }
    // El segundo control: tener el permiso no basta si fue esta misma persona
    // quien confirmó el pago. Una confirmación automática no tiene actor y no
    // bloquea a nadie.
    const segregation = requireDifferentActor(
      { actedByUserId: payment.confirmedBy, actorUserId: session.user.id },
      "Revertir un pago",
    )
    if (!segregation.ok) return { ok: false, message: segregation.message ?? "Sin autorización" }

    const now = new Date().toISOString()
    // Mismo lock de fila que confirmPaymentSuggestion: revertir también
    // recalcula allocated_amount y necesita el mismo punto de serialización
    // frente a una confirmación concurrente sobre el mismo movimiento.
    const snapshot = await db.transaction((tx) =>
      revertConfirmedPayment(tx, {
        paymentId: payment.id,
        bankTransactionId: payment.bankTransactionId,
        reason: parsed.data.reason,
        actorUserId: session.user.id,
        now,
      }),
    )

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_invoice_payment",
      entityId: payment.id,
      oldState: { status: "confirmed" },
      newState: { status: "reverted" },
      reason: parsed.data.reason,
    })

    revalidatePath("/facturacion/cobranza")
    revalidatePath(`/facturacion/facturas/${payment.invoiceId}`)
    revalidatePath("/facturacion")
    return { ok: true, message: `Pago revertido. La factura queda ${PAYMENT_STATUS_TEXT[snapshot.paymentStatus]}.` }
  } catch (err) {
    const message = safeActionMessage(err, "No se pudo revertir el pago")
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
    const message = safeActionMessage(err, "No se pudieron generar sugerencias")
    logger.error("[billing/generateSuggestions]", { message })
    return { ok: false, message }
  }
}

/* ── Alcance ─────────────────────────────────────────────────────────────── */

// `canReachInvoice` vive en `lib/services/billing/queries.ts`, junto al
// predicado de lectura del que es la contraparte puntual: tenerla privada acá
// dejó al resto del módulo escribiendo sin verificar el alcance del registro
// (H-08, AUDITORIA_BUGS_2026-08-05.md).
