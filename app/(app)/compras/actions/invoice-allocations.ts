"use server"

import { z } from "zod"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
import { InvoiceLineAllocationError, replaceInvoiceLineAllocationsTx } from "@/lib/services/purchasing-module/invoice-line-allocations"
import { INVOICE_ALLOCATION_ERRORS } from "@/lib/services/purchasing-module/invoice-allocation-feedback"
import { persistPurchaseOrderInvoiceReconciliationTx } from "@/lib/services/purchasing-module/invoice-reconciliation-service"
import type { ActionState } from "@/lib/validation/operations"

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const allocationFormSchema = z.object({
  purchaseOrderId: idSchema,
  invoiceItemId: idSchema,
  fingerprint: z.string().min(1).max(256),
  coverage: z.enum(["partial", "complete"]),
  allocations: z.array(z.object({ purchaseOrderItemId: idSchema, quantity: z.number().finite(), subtotal: z.number().finite() })).min(1).max(100),
})

export type InvoiceAllocationActionState = ActionState & { message: string; code?: string }

export async function saveInvoiceLineAllocationsAction(input: unknown): Promise<InvoiceAllocationActionState> {
  let session
  try {
    session = await requirePermission("purchasing:send_order")
  } catch {
    return { ok: false, code: "FORBIDDEN", message: "Sin permisos para modificar el reparto de facturas." }
  }
  let json: unknown
  try {
    if (typeof input !== "string" || input.length > 100_000) throw new Error("invalid")
    json = JSON.parse(input)
  } catch {
    return { ok: false, code: "INVALID_INPUT", message: "El reparto no es válido. Revisa las líneas e inténtalo nuevamente." }
  }
  const parsed = allocationFormSchema.safeParse(json)
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Revisa las líneas, cantidades y subtotales del reparto." }
  const { fingerprint, ...values } = parsed.data
  try {
    await db.transaction(async tx => {
      await replaceInvoiceLineAllocationsTx(tx, {
        ...values, expectedFingerprint: fingerprint, source: "operator",
        actor: { userId: session.user.id, userEmail: session.user.email ?? undefined },
        worksiteScope: serviceWorksiteScope(session),
      })
      await persistPurchaseOrderInvoiceReconciliationTx(tx, values.purchaseOrderId)
    })
  } catch (error) {
    if (error instanceof InvoiceLineAllocationError) return { ok: false, code: error.code, message: INVOICE_ALLOCATION_ERRORS[error.code] }
    return { ok: false, code: "SAVE_FAILED", message: "No se pudo guardar el reparto. Tus cambios siguen aquí; vuelve a intentarlo." }
  }
  revalidateOperationalViews([`/compras/${values.purchaseOrderId}`, "/compras", "/bodega/trazabilidad"])
  return { ok: true, message: "Reparto guardado y conciliación actualizada." }
}
