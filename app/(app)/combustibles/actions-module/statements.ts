"use server"

import { db } from "@/db"
import { fuelLoads, fuelMonthlyStatements, fuelPayments } from "@/db/schema"
import { eq, and, sql, inArray } from "drizzle-orm"
import { z } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { nanoid } from "@/lib/id"
import {
  createMonthlyStatementSchema,
  addPaymentSchema,
} from "@/lib/combustibles/validation"
import { calculateStatementTotals } from "@/lib/combustibles/calculations"
import { STATEMENT_MONTH_RE, previewMonthlyStatement, statementCandidateLoadsWhere, type StatementPreview } from "@/lib/combustibles/statements-preview"
import { recordAudit } from "@/lib/audit"
import type { ActionState } from "@/lib/validation/masters"
import { dbErrMsg } from "./loads"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { revalidateFuel } from "@/lib/combustibles/revalidate"
import { formatCLP } from "@/lib/utils"

const NO_PERMISSION = { ok: false as const, message: "No tienes permisos para administrar los estados de cuenta" }

/**
 * Crear un estado de cuenta, registrar un pago y ver la vista previa exigen lo
 * mismo: `manage_statements` en el submódulo de Pagos (`guardPermission` dice si
 * el módulo está apagado en vez de fingir que faltan permisos) más el contrato
 * monetario global (`assertFuelCostAccess`: ver costos y rol global).
 */
async function guardGlobalStatementSession() {
  const guard = await guardPermission("combustibles:manage_statements", FUEL_PATHS.pagos)
  if (guard.error) return guard
  try {
    assertFuelCostAccess(guard.session, { global: true })
  } catch {
    return { session: null, error: NO_PERMISSION }
  }
  return guard
}

function optionalFormNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function createMonthlyStatementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardGlobalStatementSession()
  if (error) return error

  const parsed = createMonthlyStatementSchema.safeParse({
    month: formData.get("month"),
    fuelSupplierId: formData.get("fuelSupplierId"),
    dueDate: formData.get("dueDate") || undefined,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  // Lo que la persona vio en la vista previa. Si entre la vista previa y el
  // clic cambió el conjunto de cargas (alguien registró o anuló una), se pide
  // revisar de nuevo en vez de guardar un total distinto del que confirmó.
  // Opcionales: un envío sin vista previa (otro cliente) se crea como siempre.
  const expectedLoads = optionalFormNumber(formData.get("expectedLoadCount"))
  const expectedTotal = optionalFormNumber(formData.get("expectedTotalAmount"))

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.fuelMonthlyStatements.findFirst({
        where: and(
          eq(fuelMonthlyStatements.month, parsed.data.month),
          eq(fuelMonthlyStatements.fuelSupplierId, parsed.data.fuelSupplierId),
        ),
      })
      if (existing) return { ok: false as const, message: "Ya existe un estado de cuenta para este mes y proveedor" }

      // Un estado de cuenta cobra consumo real: sin borradores ni anuladas. El
      // predicado es el mismo de la vista previa (`statementCandidateLoadsWhere`).
      const loads = await tx
        .select()
        .from(fuelLoads)
        .where(statementCandidateLoadsWhere({ month: parsed.data.month, fuelSupplierId: parsed.data.fuelSupplierId }))
        .for("update")

      if (loads.length === 0) return { ok: false as const, message: "No hay cargas sin estado de cuenta para este mes y proveedor" }

      const totals = calculateStatementTotals(loads)

      const changed =
        (expectedLoads !== null && expectedLoads !== loads.length) ||
        (expectedTotal !== null && Math.abs(expectedTotal - totals.totalAmount) > 0.005)
      if (changed) {
        return { ok: false as const, message: "Las cargas de este mes cambiaron mientras revisabas. Mira la vista previa de nuevo antes de crear el estado de cuenta." }
      }

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

      return { ok: true as const, message: `Estado de cuenta creado con ${loads.length} ${loads.length === 1 ? "carga" : "cargas"}`, data: { id } }
    })

    if (result.ok) revalidateFuel()
    return result
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al crear el estado de cuenta") }
  }
}

export async function addPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { session, error } = await guardGlobalStatementSession()
  if (error) return error

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

      if (!statement) return { ok: false as const, message: "Estado de cuenta no encontrado" }
      if (statement.status === "paid" || statement.status === "cancelled") {
        return { ok: false as const, message: "No se pueden agregar pagos a este estado de cuenta" }
      }

      const pending = (statement.totalAmount ?? 0) - (statement.paidAmount ?? 0)
      if (parsed.data.amount > pending) {
        return { ok: false as const, message: `El pago excede lo que falta por pagar (${formatCLP(pending)})` }
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

    if (result.ok) revalidateFuel()
    return result
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al registrar pago") }
  }
}

const previewInputSchema = z.object({
  month: z.string().regex(STATEMENT_MONTH_RE, "Elige un mes"),
  fuelSupplierId: z.string().min(1, "Elige un proveedor"),
})

/**
 * Vista previa de «Crear estado de cuenta»: de sólo lectura, pero con el mismo
 * permiso de la acción que confirma (`manage_statements` + costos + alcance
 * global). Lo que muestra es lo que `createMonthlyStatementAction` guardaría.
 */
export async function previewMonthlyStatementAction(
  input: { month: string; fuelSupplierId: string },
): Promise<{ ok: true; data: { preview: StatementPreview } } | { ok: false; message: string }> {
  const { session, error } = await guardGlobalStatementSession()
  if (error) return error

  const parsed = previewInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa los datos" }

  try {
    return { ok: true, data: { preview: await previewMonthlyStatement(session, parsed.data) } }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "No se pudo armar la vista previa") }
  }
}
