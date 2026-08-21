"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { fuelLoads, fuelMonthlyStatements, fuelPayments } from "@/db/schema"
import { eq, and, sql, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { nanoid } from "@/lib/id"
import {
  createMonthlyStatementSchema,
  addPaymentSchema,
} from "@/lib/combustibles/validation"
import { calculateStatementTotals } from "@/lib/combustibles/calculations"
import { recordAudit } from "@/lib/audit"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"

async function requireGlobalStatementSession() {
  const session = await requirePermission("combustibles:manage_statements", "/combustibles")
  assertFuelCostAccess(session, { global: true })
  return session
}

export async function createMonthlyStatementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requireGlobalStatementSession() }
  catch { return { ok: false, message: "Sin permisos para administrar la cuenta corriente" } }

  const parsed = createMonthlyStatementSchema.safeParse({
    month: formData.get("month"),
    fuelSupplierId: formData.get("fuelSupplierId"),
    dueDate: formData.get("dueDate") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.fuelMonthlyStatements.findFirst({
        where: and(
          eq(fuelMonthlyStatements.month, parsed.data.month),
          eq(fuelMonthlyStatements.fuelSupplierId, parsed.data.fuelSupplierId),
        ),
      })
      if (existing) return { ok: false as const, message: "Ya existe un resumen para este mes y proveedor" }

      const loads = await tx
        .select()
        .from(fuelLoads)
        .where(and(
          // Un estado de cuenta cobra consumo real: sin esto arrastraba
          // borradores a medio capturar y cargas anuladas.
          accountableFuelLoadsWhere(),
          eq(fuelLoads.month, parsed.data.month),
          eq(fuelLoads.fuelSupplierId, parsed.data.fuelSupplierId),
          sql`${fuelLoads.statementId} IS NULL`,
        ))
        .for("update")

      if (loads.length === 0) return { ok: false as const, message: "No hay cargas sin asignar para este mes y proveedor" }

      const totals = calculateStatementTotals(loads)

      const id = nanoid()
      await tx.insert(fuelMonthlyStatements).values({
        id,
        ...parsed.data,
        ...totals,
        createdBy: session.user.id,
      })

      await tx.update(fuelLoads)
        .set({ statementId: id, updatedAt: new Date().toISOString() })
        .where(inArray(fuelLoads.id, loads.map((load) => load.id)))

      await recordAudit({
        userId: session.user.id,
        action: "create",
        entityType: "fuel_statement",
        entityId: id,
        newState: { month: parsed.data.month, fuelSupplierId: parsed.data.fuelSupplierId, ...totals },
      }, tx)

      return { ok: true as const, message: `Resumen creado con ${loads.length} cargas`, data: { id } }
    })

    if (result.ok) revalidatePath("/combustibles/cuenta-corriente")
    return result
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al crear resumen") }
  }
}

export async function addPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requireGlobalStatementSession() }
  catch { return { ok: false, message: "Sin permisos para administrar la cuenta corriente" } }

  const parsed = addPaymentSchema.safeParse({
    statementId: formData.get("statementId"),
    paymentDate: formData.get("paymentDate"),
    amount: formData.get("amount"),
    paymentMethod: formData.get("paymentMethod") || undefined,
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [statement] = await tx
        .select()
        .from(fuelMonthlyStatements)
        .where(eq(fuelMonthlyStatements.id, parsed.data.statementId))
        .for("update")

      if (!statement) return { ok: false as const, message: "Resumen no encontrado" }
      if (statement.status === "paid" || statement.status === "cancelled") {
        return { ok: false as const, message: "No se pueden agregar pagos a este resumen" }
      }

      const pending = (statement.totalAmount ?? 0) - (statement.paidAmount ?? 0)
      if (parsed.data.amount > pending) {
        return { ok: false as const, message: `El pago excede el saldo pendiente ($${pending.toLocaleString("es-CL")})` }
      }

      const paymentId = nanoid()
      await tx.insert(fuelPayments).values({
        id: paymentId,
        ...parsed.data,
        createdBy: session.user.id,
      })

      await recordAudit({
        userId: session.user.id,
        action: "create",
        entityType: "fuel_payment",
        entityId: paymentId,
        newState: { statementId: parsed.data.statementId, amount: parsed.data.amount },
      }, tx)

      const [paidRow] = await tx
        .select({ paid: sql<number>`COALESCE(SUM(${fuelPayments.amount}), 0)` })
        .from(fuelPayments)
        .where(eq(fuelPayments.statementId, parsed.data.statementId))

      const newPaidAmount = Number(paidRow?.paid ?? 0)
      const newStatus = newPaidAmount >= (statement.totalAmount ?? 0) ? "paid" : "partial"

      await tx.update(fuelMonthlyStatements).set({
        paidAmount: newPaidAmount,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      }).where(eq(fuelMonthlyStatements.id, parsed.data.statementId))

      return { ok: true as const, message: "Pago registrado" }
    })

    if (result.ok) revalidatePath("/combustibles/cuenta-corriente")
    return result
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al registrar pago") }
  }
}
