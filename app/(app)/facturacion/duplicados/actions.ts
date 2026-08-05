"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { billingDuplicateCandidates } from "@/db/schema"
import { guardPermission } from "@/lib/auth/can"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import {
  detectDuplicateCandidates,
  dismissDuplicate,
  mergeDuplicate,
  DuplicateMergeError,
} from "@/lib/services/billing/duplicates"
import type { ActionResult } from "../actions"

/** Busca pares sospechosos. No fusiona nada: solo los marca para revisión. */
export async function detectDuplicatesAction(): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  try {
    const result = await detectDuplicateCandidates({ direction: "sale" })
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "billing_duplicate_scan",
      entityId: new Date().toISOString(),
      newState: { ...result },
    })
    revalidatePath("/facturacion/duplicados")
    return {
      ok: true,
      message: `${result.created} pares nuevos sobre ${result.scanned} facturas revisadas. Ninguno se fusiona solo.`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo revisar duplicados"
    logger.error("[billing/detectDuplicates]", { message })
    return { ok: false, message }
  }
}

const resolveSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(["merge", "dismiss"]),
  /** Cuál de las dos facturas sobrevive. Obligatorio al fusionar. */
  keepId: z.string().min(1).nullable().optional(),
})

/**
 * Resuelve un candidato a duplicado.
 *
 * Fusionar exige elegir explícitamente cuál factura sobrevive: la plataforma no
 * decide por antigüedad ni por fuente, porque cualquiera de esos criterios
 * podría descartar la que tiene los datos correctos.
 */
export async function resolveDuplicateAction(input: unknown): Promise<ActionResult> {
  const { session, error } = await guardPermission("billing:manage_invoices")
  if (error) return error

  const parsed = resolveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: "Datos inválidos" }
  const { candidateId, decision, keepId } = parsed.data

  try {
    const candidate = await db.query.billingDuplicateCandidates.findFirst({
      where: eq(billingDuplicateCandidates.id, candidateId),
      columns: { id: true, invoiceId: true, otherInvoiceId: true, status: true },
    })
    if (!candidate) return { ok: false, message: "El caso no existe" }
    if (candidate.status !== "open") return { ok: false, message: "El caso ya fue resuelto" }

    if (decision === "dismiss") {
      await dismissDuplicate(candidateId, session.user.id)
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "billing_duplicate_candidate",
        entityId: candidateId,
        oldState: { status: "open" },
        newState: { status: "dismissed" },
      })
      revalidatePath("/facturacion/duplicados")
      return { ok: true, message: "Caso descartado: no son el mismo documento." }
    }

    if (!keepId || (keepId !== candidate.invoiceId && keepId !== candidate.otherInvoiceId)) {
      return { ok: false, message: "Indica cuál de las dos facturas debe sobrevivir" }
    }
    const dropId = keepId === candidate.invoiceId ? candidate.otherInvoiceId : candidate.invoiceId

    await mergeDuplicate({ candidateId, keepId, dropId, actorUserId: session.user.id })

    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "billing_duplicate_candidate",
      entityId: candidateId,
      oldState: { status: "open" },
      newState: { status: "merged", keepId, dropId },
    })

    revalidatePath("/facturacion/duplicados")
    revalidatePath("/facturacion/facturas")
    revalidatePath("/facturacion")
    return {
      ok: true,
      message: "Facturas fusionadas. La descartada queda anulada, con su historia intacta y su referencia a la superviviente.",
    }
  } catch (err) {
    if (err instanceof DuplicateMergeError) return { ok: false, message: err.message }
    const message = err instanceof Error ? err.message : "No se pudo resolver el caso"
    logger.error("[billing/resolveDuplicate]", { message })
    return { ok: false, message }
  }
}
