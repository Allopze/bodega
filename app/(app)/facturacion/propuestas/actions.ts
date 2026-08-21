"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import {
  billingInvoiceLinks,
  billingInvoices,
  billingProposalItems,
  billingProposals,
  contracts,
} from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { recordInvoiceEvent } from "@/lib/services/billing/invoices"
import { canReachInvoice } from "@/lib/services/billing/queries"
import {
  assertProposalTransition,
  computeProposalTotals,
  nextProposalCode,
  ProposalTransitionError,
  type ProposalStatus,
  type ProposalTransition,
} from "@/lib/services/billing/proposals"
import { multiplyAmount } from "@/lib/services/billing/money"
import { assertCostCenterAllowed } from "@/lib/services/cost-centers"
import type { ActionResult } from "../actions"

const itemSchema = z.object({
  description: z.string().min(2, "Cada ítem necesita una descripción"),
  quantity: z.number().finite().positive("La cantidad debe ser mayor que cero"),
  unit: z.string().max(20).nullable().optional(),
  unitPrice: z.number().finite().nonnegative(),
  isExempt: z.boolean().default(false),
})

const proposalSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecciona un cliente"),
  contractId: z.string().min(1).nullable().optional(),
  worksiteId: z.string().min(1).nullable().optional(),
  costCenterId: z.string().min(1).nullable().optional(),
  servicePeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El período debe tener formato AAAA-MM"),
  serviceFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  serviceTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("CLP"),
  clientPoNumber: z.string().max(120).nullable().optional(),
  missingDocuments: z.string().max(1000).nullable().optional(),
  observations: z.string().max(2000).nullable().optional(),
  items: z.array(itemSchema).min(1, "Agrega al menos un ítem"),
})

/**
 * Crea o actualiza una propuesta con sus ítems.
 *
 * Los totales **siempre** se recalculan desde los ítems: un total tecleado que
 * no cuadre con sus líneas sería una cifra sin respaldo.
 *
 * Solo se puede editar una propuesta en `draft` u `observed`. Una aprobada es
 * una decisión tomada; cambiarle los montos por debajo invalidaría la
 * aprobación.
 */
export async function saveProposalAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:create_proposal")
  if (error) return error

  const parsed = proposalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const data = parsed.data

  const scope = resolveWorksiteScope(session)
  if (data.worksiteId && scope.mode === "some" && !scope.ids.includes(data.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esa faena" }
  }
  if (scope.mode === "none") return { ok: false, message: "No tienes acceso a ninguna faena" }
  if (data.serviceFrom && data.serviceTo && data.serviceFrom > data.serviceTo) {
    return { ok: false, message: "La fecha de término del servicio no puede ser anterior al inicio" }
  }

  if (data.contractId) {
    const contract = await db.query.contracts.findFirst({
      where: eq(contracts.id, data.contractId),
      columns: { id: true, clientId: true },
    })
    if (!contract) return { ok: false, message: "El contrato no existe" }
    if (contract.clientId !== data.clientId) {
      return { ok: false, message: "El contrato no pertenece al cliente seleccionado" }
    }
  }

  const totals = computeProposalTotals(data.items)
  const now = new Date().toISOString()

  try {
    const proposalId = await db.transaction(async (tx) => {
      let id = data.id
      // Mismo contrato que Mantenciones: el centro de costo debe existir, estar
      // vigente y no pertenecer a otra faena que la del hecho imputado.
      if (data.costCenterId) await assertCostCenterAllowed(tx, data.costCenterId, data.worksiteId ?? null)

      if (id) {
        const existing = await tx.query.billingProposals.findFirst({
          where: eq(billingProposals.id, id),
          columns: { id: true, status: true, worksiteId: true },
        })
        if (!existing) throw new Error("La propuesta no existe")
        if (existing.status !== "draft" && existing.status !== "observed") {
          throw new Error("Solo se puede editar una propuesta en borrador u observada")
        }
        // El alcance ya se validó sobre la faena *entrante*; falta la de la
        // propuesta que se está editando. Sin esto, un rol acotado podía tomar
        // una propuesta ajena y moverla a su faena (H-08,
        // AUDITORIA_BUGS_2026-08-05.md).
        if (scope.mode === "some" && (!existing.worksiteId || !scope.ids.includes(existing.worksiteId))) {
          throw new Error("No tienes acceso a esta propuesta")
        }

        await tx.update(billingProposals).set({
          clientId: data.clientId,
          contractId: data.contractId ?? null,
          worksiteId: data.worksiteId ?? null,
          costCenterId: data.costCenterId ?? null,
          servicePeriod: data.servicePeriod,
          serviceFrom: data.serviceFrom ?? null,
          serviceTo: data.serviceTo ?? null,
          currency: data.currency,
          clientPoNumber: data.clientPoNumber ?? null,
          missingDocuments: data.missingDocuments ?? null,
          observations: data.observations ?? null,
          estimatedNet: totals.net,
          estimatedTax: totals.tax,
          estimatedTotal: totals.total,
          updatedAt: now,
        }).where(eq(billingProposals.id, id))

        await tx.delete(billingProposalItems).where(eq(billingProposalItems.proposalId, id))
      } else {
        id = nanoid()
        const code = await nextProposalCode(tx, Number(data.servicePeriod.slice(0, 4)))
        await tx.insert(billingProposals).values({
          id,
          code,
          clientId: data.clientId,
          contractId: data.contractId ?? null,
          worksiteId: data.worksiteId ?? null,
          costCenterId: data.costCenterId ?? null,
          servicePeriod: data.servicePeriod,
          serviceFrom: data.serviceFrom ?? null,
          serviceTo: data.serviceTo ?? null,
          currency: data.currency,
          clientPoNumber: data.clientPoNumber ?? null,
          missingDocuments: data.missingDocuments ?? null,
          observations: data.observations ?? null,
          estimatedNet: totals.net,
          estimatedTax: totals.tax,
          estimatedTotal: totals.total,
          status: "draft",
          ownerUserId: session.user.id,
          createdBy: session.user.id,
        })
      }

      await tx.insert(billingProposalItems).values(
        data.items.map((item, index) => ({
          id: nanoid(),
          proposalId: id!,
          description: item.description.trim(),
          quantity: item.quantity,
          unit: item.unit ?? null,
          unitPrice: item.unitPrice,
          netAmount: multiplyAmount(item.unitPrice, item.quantity),
          isExempt: item.isExempt,
          sortOrder: index,
        })),
      )

      return id!
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: data.id ? "update" : "create",
      entityType: "billing_proposal",
      entityId: proposalId,
      newState: { servicePeriod: data.servicePeriod, estimatedTotal: totals.total, currency: data.currency },
    })

    revalidatePath("/facturacion/propuestas")
    revalidatePath("/facturacion/pendientes")
    return { ok: true, message: data.id ? "Propuesta actualizada" : "Propuesta creada" }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar la propuesta"
    logger.error("[billing/saveProposal]", { message })
    // El índice único (contrato, período) evita dos propuestas vivas del mismo
    // cobro; el mensaje tiene que decirlo en términos del negocio.
    if (/billing_proposals_contract_period_unique/.test(message)) {
      return { ok: false, message: "Ya existe una propuesta viva para ese contrato y período" }
    }
    if (/billing_proposals_code_unique/.test(message)) {
      return { ok: false, message: "Otro usuario creó una propuesta al mismo tiempo. Vuelve a intentarlo." }
    }
    return { ok: false, message }
  }
}

const transitionSchema = z.object({
  proposalId: z.string().min(1),
  transition: z.enum(["submit", "observe", "approve", "reject", "mark_ready", "cancel", "reopen"]),
  reason: z.string().max(1000).nullable().optional(),
})

/**
 * Mueve una propuesta de estado.
 *
 * **Aprobar no emite ningún documento tributario.** La emisión sigue siendo un
 * acto manual en el portal del emisor; acá solo se registra que el cobro quedó
 * autorizado internamente.
 */
export async function transitionProposalAction(input: unknown): Promise<ActionResult> {
  const parsed = transitionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const { proposalId, transition, reason } = parsed.data

  // Una sola guarda de entrada al módulo. El permiso ESPECÍFICO de cada
  // transición (crear / revisar / aprobar) lo exige `assertProposalTransition`
  // contra los permisos de la sesión: así la regla vive en un solo lugar y la
  // prueba unitaria la ejercita sin base de datos.
  const { session: actor, error } = await guardPermission("billing:view")
  if (error) return error

  try {
    const proposal = await db.query.billingProposals.findFirst({
      where: eq(billingProposals.id, proposalId),
      columns: {
        id: true, status: true, submittedBy: true, createdBy: true,
        missingDocuments: true, worksiteId: true, code: true,
      },
    })
    if (!proposal) return { ok: false, message: "La propuesta no existe" }

    const scope = resolveWorksiteScope(actor)
    if (scope.mode === "none") return { ok: false, message: "No tienes acceso a ninguna faena" }
    if (scope.mode === "some" && (!proposal.worksiteId || !scope.ids.includes(proposal.worksiteId))) {
      return { ok: false, message: "No tienes acceso a esa faena" }
    }

    const nextStatus = assertProposalTransition({
      currentStatus: proposal.status as ProposalStatus,
      transition: transition as ProposalTransition,
      permissions: actor.user.permissions,
      actorUserId: actor.user.id,
      submittedBy: proposal.submittedBy,
      createdBy: proposal.createdBy,
      missingDocuments: proposal.missingDocuments,
      reason,
    })

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = { status: nextStatus, updatedAt: now }
    if (transition === "submit") {
      updates.submittedBy = actor.user.id
      updates.submittedAt = now
      updates.decisionReason = null
    }
    if (transition === "observe" || transition === "reject") {
      updates.reviewedBy = actor.user.id
      updates.reviewedAt = now
      updates.decisionReason = reason ?? null
    }
    if (transition === "approve") {
      updates.approvedBy = actor.user.id
      updates.approvedAt = now
      updates.reviewedBy = actor.user.id
      updates.reviewedAt = now
    }
    if (transition === "reopen") {
      updates.submittedBy = null
      updates.submittedAt = null
    }

    await db.update(billingProposals).set(updates).where(eq(billingProposals.id, proposalId))

    await recordAudit({
      userId: actor.user.id,
      userEmail: actor.user.email ?? undefined,
      action: "status_change",
      entityType: "billing_proposal",
      entityId: proposalId,
      entityCode: proposal.code,
      oldState: { status: proposal.status },
      newState: { status: nextStatus },
      reason: reason ?? undefined,
    })

    revalidatePath("/facturacion/propuestas")
    revalidatePath("/facturacion/pendientes")
    return { ok: true, message: TRANSITION_MESSAGES[transition] }
  } catch (err) {
    if (err instanceof ProposalTransitionError) return { ok: false, message: err.message }
    const message = err instanceof Error ? err.message : "No se pudo cambiar el estado"
    logger.error("[billing/transitionProposal]", { message })
    return { ok: false, message }
  }
}

const TRANSITION_MESSAGES: Record<ProposalTransition, string> = {
  submit:     "Propuesta enviada a revisión",
  observe:    "Propuesta observada",
  approve:    "Propuesta aprobada. La emisión del documento sigue siendo manual en el portal.",
  reject:     "Propuesta rechazada",
  mark_ready: "Propuesta lista para facturar",
  cancel:     "Propuesta anulada",
  reopen:     "Propuesta reabierta como borrador",
}

const relateSchema = z.object({
  proposalId: z.string().min(1),
  invoiceId: z.string().min(1),
})

/**
 * Relaciona una propuesta con la factura que finalmente la cobró.
 *
 * Es el paso que cierra el ciclo interno: crea el vínculo operacional de la
 * factura (confirmado, porque lo decide una persona) y deja la propuesta en
 * `invoiced`. Con eso deja de aparecer como pendiente.
 */
export async function relateProposalToInvoiceAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  const parsed = relateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Datos inválidos" }
  const { proposalId, invoiceId } = parsed.data

  try {
    const [proposal, invoice] = await Promise.all([
      db.query.billingProposals.findFirst({
        where: eq(billingProposals.id, proposalId),
        columns: {
          id: true, status: true, code: true, clientId: true, contractId: true,
          worksiteId: true, costCenterId: true, servicePeriod: true,
          clientPoNumber: true, estimatedTotal: true, currency: true,
        },
      }),
      db.query.billingInvoices.findFirst({
        where: eq(billingInvoices.id, invoiceId),
        columns: { id: true, direction: true, currency: true, totalAmount: true, folio: true },
      }),
    ])

    if (!proposal) return { ok: false, message: "La propuesta no existe" }
    if (!invoice) return { ok: false, message: "La factura no existe" }
    if (invoice.direction !== "sale") {
      return { ok: false, message: "Solo se puede relacionar con una factura de venta" }
    }
    if (proposal.status !== "approved" && proposal.status !== "ready") {
      return { ok: false, message: "Solo una propuesta aprobada o lista se puede relacionar con una factura" }
    }
    if (invoice.currency !== proposal.currency) {
      return { ok: false, message: `La factura está en ${invoice.currency} y la propuesta en ${proposal.currency}` }
    }

    const scope = resolveWorksiteScope(session)
    if (scope.mode === "some" && (!proposal.worksiteId || !scope.ids.includes(proposal.worksiteId))) {
      return { ok: false, message: "No tienes acceso a esa faena" }
    }
    // El alcance de la propuesta no basta: la factura llega por ID desde el
    // cliente y vincularla la abre a toda lectura futura (H-08 dejó esta
    // guarda como obligatoria para toda escritura que reciba un invoiceId).
    if (!(await canReachInvoice(session, invoiceId))) {
      return { ok: false, message: "No tienes acceso a esta factura" }
    }

    const now = new Date().toISOString()
    await db.transaction(async (tx) => {
      await tx.insert(billingInvoiceLinks).values({
        id: nanoid(),
        invoiceId,
        clientId: proposal.clientId,
        contractId: proposal.contractId,
        worksiteId: proposal.worksiteId,
        costCenterId: proposal.costCenterId,
        proposalId: proposal.id,
        servicePeriod: proposal.servicePeriod,
        clientPoNumber: proposal.clientPoNumber,
        status: "confirmed",
        matchedBy: "user",
        confirmedBy: session.user.id,
        confirmedAt: now,
        createdBy: session.user.id,
        evidence: { proposalCode: proposal.code, estimatedTotal: proposal.estimatedTotal },
      })

      await tx.update(billingProposals)
        .set({ status: "invoiced", updatedAt: now })
        .where(eq(billingProposals.id, proposalId))

      await recordInvoiceEvent(tx, {
        invoiceId,
        eventType: "invoice.linked_to_proposal",
        actorKind: "user",
        actorUserId: session.user.id,
        detail: {
          proposalCode: proposal.code,
          estimatedTotal: proposal.estimatedTotal,
          invoicedTotal: invoice.totalAmount,
        },
      })
    })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "status_change",
      entityType: "billing_proposal",
      entityId: proposalId,
      entityCode: proposal.code,
      oldState: { status: proposal.status },
      newState: { status: "invoiced", invoiceId },
    })

    revalidatePath("/facturacion/propuestas")
    revalidatePath("/facturacion/pendientes")
    revalidatePath(`/facturacion/facturas/${invoiceId}`)

    // La diferencia entre lo preparado y lo emitido es información valiosa: se
    // informa, no se esconde.
    const difference = invoice.totalAmount - proposal.estimatedTotal
    const note = Math.abs(difference) >= 1
      ? ` Atención: la factura difiere de la propuesta en ${difference > 0 ? "+" : ""}${difference.toLocaleString("es-CL")} ${invoice.currency}.`
      : ""
    return { ok: true, message: `Propuesta ${proposal.code} relacionada con la factura ${invoice.folio}.${note}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo relacionar la propuesta"
    logger.error("[billing/relateProposal]", { message })
    return { ok: false, message }
  }
}
