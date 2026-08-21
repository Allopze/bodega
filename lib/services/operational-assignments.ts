import { and, eq, or } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { purchaseOrders, purchaseRequestItems, purchaseRequests, workItemAssignments } from "@/db/schema"
import { itemHasNoActiveOrderSql } from "@/lib/adquisiciones/pending-purchase"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { isRealIsoDate } from "@/lib/validation/operations"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import {
  operationalAssignmentKey,
  type OperationalWorkItemAssignment,
} from "@/lib/services/operational-work-queue"
import type { Session } from "next-auth"

const assignmentSchema = z.object({
  sourceType: z.enum(["purchase_request", "purchase_request_item", "purchase_order"]),
  sourceId: z.string().min(1).max(200),
  actionKey: z.enum(["complete", "follow_up", "approve", "create_order", "issue", "send", "receive_office", "receive_worksite", "deliver"]),
  // El regex por sí solo deja pasar 2026-99-99, que se persistía como fecha de
  // compromiso y ordenaba mal el índice por vencimiento.
  committedDueAt: z.string()
    .refine(isRealIsoDate, "Fecha de compromiso inválida")
    .nullable(),
})

export type OperationalAssignmentInput = z.infer<typeof assignmentSchema>

export type OperationalAssignmentReference = Pick<
  OperationalAssignmentInput,
  "sourceType" | "sourceId" | "actionKey"
> & { worksiteId: string }

type Source = { worksiteId: string; active: boolean; entityCode: string | null }

/** El mismo criterio de cobertura activa que usa la cola de Compras. */
async function hasNoActiveOrderCoverage(requestItemId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: purchaseRequestItems.id })
    .from(purchaseRequestItems)
    .where(and(eq(purchaseRequestItems.id, requestItemId), itemHasNoActiveOrderSql))
  return Boolean(row)
}

async function resolveSource(input: OperationalAssignmentInput): Promise<Source> {
  if (input.sourceType === "purchase_request") {
    const request = await db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, input.sourceId),
      columns: { worksiteId: true, status: true, code: true },
    })
    if (!request || !["complete", "follow_up"].includes(input.actionKey)) throw new Error("Pendiente no encontrado o etapa no comprometible")
    const active = input.actionKey === "complete"
      ? request.status === "draft"
      : ["submitted", "in_review", "partially_approved", "approved", "in_purchasing"].includes(request.status)
    return { worksiteId: request.worksiteId, active, entityCode: request.code }
  }
  if (input.sourceType === "purchase_request_item") {
    const row = await db.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, input.sourceId),
      with: { request: { columns: { worksiteId: true, code: true } } },
      columns: { status: true },
    })
    if (!row) throw new Error("Ítem de solicitud no encontrado")
    const expected: Record<string, string[]> = {
      approve: ["requested"],
      create_order: ["approved", "pending_purchase"],
      deliver: ["received", "partially_received", "partially_delivered"],
    }
    const statuses = expected[input.actionKey]
    if (!statuses) throw new Error("Etapa de ítem no comprometible")
    // `create_order` es la única etapa cuya vigencia no se agota en el estado
    // del ítem: "aprobado" deja de ser trabajo de Compras en cuanto una OC
    // activa lo cubre. La fuente de la cola ya lo descuenta con el mismo
    // predicado, así que sin esto se podía comprometer —y quedar comprometida—
    // una tarea que /pendientes ya no ofrece.
    const stillPurchasable = input.actionKey !== "create_order"
      || await hasNoActiveOrderCoverage(input.sourceId)
    return {
      worksiteId: row.request.worksiteId,
      active: statuses.includes(row.status) && stillPurchasable,
      entityCode: row.request.code,
    }
  }
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, input.sourceId),
    columns: { worksiteId: true, status: true, code: true, deliveryMode: true },
  })
  if (!order) throw new Error("Orden de compra no encontrada")
  const expected: Record<string, string[]> = {
    issue: ["draft"],
    receive_office: ["sent", "partially_office_received"],
    receive_worksite: order.deliveryMode === "directo_faena" ? ["sent", "partially_received"] : ["partially_office_received", "office_received", "partially_received"],
  }
  const statuses = expected[input.actionKey]
  if (!statuses) throw new Error("Etapa de orden no comprometible")
  return { worksiteId: order.worksiteId, active: statuses.includes(order.status), entityCode: order.code }
}

/**
 * Lee compromisos para etapas que la página de origen ya cargó y autorizó.
 * El predicado incluye la faena de la fila persistida y se vuelve a validar
 * contra la sesión; así un identificador ajeno no puede revelar una fecha.
 */
export async function getOperationalAssignmentRecords(
  references: OperationalAssignmentReference[],
  session: Session,
): Promise<Map<string, OperationalWorkItemAssignment>> {
  const visible = references.flatMap((reference) => {
    const parsed = assignmentSchema.pick({ sourceType: true, sourceId: true, actionKey: true }).safeParse(reference)
    if (!parsed.success || !reference.worksiteId || !canAccessWorksite(session, reference.worksiteId)) return []
    return [{ ...parsed.data, worksiteId: reference.worksiteId }]
  })
  if (visible.length === 0) return new Map()

  const rows = await db
    .select({
      sourceType: workItemAssignments.sourceType,
      sourceId: workItemAssignments.sourceId,
      actionKey: workItemAssignments.actionKey,
      committedDueAt: workItemAssignments.committedDueAt,
    })
    .from(workItemAssignments)
    .where(or(...visible.map((reference) => and(
      eq(workItemAssignments.sourceType, reference.sourceType),
      eq(workItemAssignments.sourceId, reference.sourceId),
      eq(workItemAssignments.actionKey, reference.actionKey),
      eq(workItemAssignments.worksiteId, reference.worksiteId),
    ))))

  return new Map(rows.map((row) => [
    operationalAssignmentKey(row.sourceType, row.sourceId, row.actionKey),
    { committedDueAt: row.committedDueAt },
  ]))
}

export async function upsertOperationalAssignment(rawInput: OperationalAssignmentInput, session: Session) {
  const input = assignmentSchema.parse(rawInput)
  const source = await resolveSource(input)
  if (!source.active) throw new Error("La etapa ya no está pendiente; no se puede comprometer")
  if (!canAccessWorksite(session, source.worksiteId)) throw new Error("No tienes acceso a la faena de este pendiente")

  await db.transaction(async (tx) => {
    const current = await tx.query.workItemAssignments.findFirst({
      where: and(eq(workItemAssignments.sourceType, input.sourceType), eq(workItemAssignments.sourceId, input.sourceId), eq(workItemAssignments.actionKey, input.actionKey)),
    })
    const now = new Date().toISOString()
    const values = { committedDueAt: input.committedDueAt, updatedAt: now }
    if (current) {
      await tx.update(workItemAssignments).set(values).where(eq(workItemAssignments.id, current.id))
    } else {
      await tx.insert(workItemAssignments).values({ id: nanoid(), sourceType: input.sourceType, sourceId: input.sourceId, actionKey: input.actionKey, worksiteId: source.worksiteId, createdAt: now, ...values })
    }
    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined, action: current ? "update" : "create",
      entityType: "work_item_assignment", entityId: `${input.sourceType}:${input.sourceId}:${input.actionKey}`, entityCode: source.entityCode ?? undefined,
      oldState: current ? { committedDueAt: current.committedDueAt } : undefined,
      newState: { committedDueAt: input.committedDueAt, worksiteId: source.worksiteId },
    }, tx)
    await recordOperationalActivity({
      eventType: input.committedDueAt ? "work.committed" : "work.uncommitted",
      module: "operaciones", entityType: "work_item_assignment", entityId: `${input.sourceType}:${input.sourceId}:${input.actionKey}`,
      entityCode: source.entityCode, worksiteId: source.worksiteId, actorUserId: session.user.id, actorSnapshot: session.user.name ?? null,
      payload: { sourceType: input.sourceType, actionKey: input.actionKey, hasCommitment: Boolean(input.committedDueAt) },
    }, tx)
  })
}
