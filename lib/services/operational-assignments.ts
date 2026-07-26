import { and, eq, inArray, or } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { purchaseOrders, purchaseRequestItems, purchaseRequests, users, workItemAssignments } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"
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
  assigneeUserId: z.string().min(1).max(200).nullable(),
  committedDueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de compromiso inválida").nullable(),
})

export type OperationalAssignmentInput = z.infer<typeof assignmentSchema>

export type OperationalAssignmentReference = Pick<
  OperationalAssignmentInput,
  "sourceType" | "sourceId" | "actionKey"
> & { worksiteId: string }

type Source = { worksiteId: string; permission: string; active: boolean; entityCode: string | null }

async function resolveSource(input: OperationalAssignmentInput): Promise<Source> {
  if (input.sourceType === "purchase_request") {
    const request = await db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, input.sourceId),
      columns: { worksiteId: true, status: true, code: true },
    })
    if (!request || !["complete", "follow_up"].includes(input.actionKey)) throw new Error("Pendiente no encontrado o etapa no asignable")
    const active = input.actionKey === "complete"
      ? ["draft", "returned"].includes(request.status)
      : ["submitted", "in_review", "partially_approved", "approved", "in_purchasing", "returned"].includes(request.status)
    return { worksiteId: request.worksiteId, permission: input.actionKey === "complete" ? "requests:create" : "requests:view_all", active, entityCode: request.code }
  }
  if (input.sourceType === "purchase_request_item") {
    const row = await db.query.purchaseRequestItems.findFirst({
      where: eq(purchaseRequestItems.id, input.sourceId),
      with: { request: { columns: { worksiteId: true, code: true } } },
      columns: { status: true },
    })
    if (!row) throw new Error("Ítem de solicitud no encontrado")
    const expected: Record<string, { statuses: string[]; permission: string }> = {
      approve: { statuses: ["requested"], permission: "approvals:approve" },
      create_order: { statuses: ["approved", "pending_purchase"], permission: "purchasing:create_order" },
      deliver: { statuses: ["received", "partially_received", "partially_delivered"], permission: "deliveries:create" },
    }
    const rule = expected[input.actionKey]
    if (!rule) throw new Error("Etapa de ítem no asignable")
    return { worksiteId: row.request.worksiteId, permission: rule.permission, active: rule.statuses.includes(row.status), entityCode: row.request.code }
  }
  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, input.sourceId),
    columns: { worksiteId: true, status: true, code: true, deliveryMode: true },
  })
  if (!order) throw new Error("Orden de compra no encontrada")
  const expected: Record<string, { statuses: string[]; permission: string }> = {
    issue: { statuses: ["draft"], permission: "purchasing:create_order" },
    send: { statuses: ["issued"], permission: "purchasing:send_order" },
    receive_office: { statuses: ["sent", "partially_office_received"], permission: "receiving:register_office" },
    receive_worksite: { statuses: order.deliveryMode === "directo_faena" ? ["sent", "partially_received"] : ["partially_office_received", "office_received", "partially_received"], permission: "receiving:register_faena" },
  }
  const rule = expected[input.actionKey]
  if (!rule) throw new Error("Etapa de orden no asignable")
  return { worksiteId: order.worksiteId, permission: rule.permission, active: rule.statuses.includes(order.status), entityCode: order.code }
}

export async function getOperationalAssignmentCandidates(input: Pick<OperationalAssignmentInput, "sourceType" | "sourceId" | "actionKey">, session: Session) {
  const parsed = assignmentSchema.pick({ sourceType: true, sourceId: true, actionKey: true }).parse(input)
  const source = await resolveSource({ ...parsed, assigneeUserId: null, committedDueAt: null })
  if (!canAccessWorksite(session, source.worksiteId)) throw new Error("No tienes acceso a la faena de este pendiente")
  const ids = await getUserIdsWithPermissionForWorksite(source.permission, source.worksiteId)
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.isActive, true), inArray(users.id, ids))).orderBy(users.name)
}

/**
 * Lee asignaciones para etapas que la página de origen ya cargó y autorizó.
 * El predicado incluye la faena de la fila persistida y se vuelve a validar
 * contra la sesión; así un identificador ajeno no puede revelar un responsable.
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
      assigneeUserId: workItemAssignments.assigneeUserId,
      assigneeName: users.name,
      committedDueAt: workItemAssignments.committedDueAt,
    })
    .from(workItemAssignments)
    .leftJoin(users, eq(workItemAssignments.assigneeUserId, users.id))
    .where(or(...visible.map((reference) => and(
      eq(workItemAssignments.sourceType, reference.sourceType),
      eq(workItemAssignments.sourceId, reference.sourceId),
      eq(workItemAssignments.actionKey, reference.actionKey),
      eq(workItemAssignments.worksiteId, reference.worksiteId),
    ))))

  return new Map(rows.map((row) => [
    operationalAssignmentKey(row.sourceType, row.sourceId, row.actionKey),
    {
      assigneeUserId: row.assigneeUserId,
      assigneeName: row.assigneeName,
      committedDueAt: row.committedDueAt,
    },
  ]))
}

export async function upsertOperationalAssignment(rawInput: OperationalAssignmentInput, session: Session) {
  const input = assignmentSchema.parse(rawInput)
  const source = await resolveSource(input)
  if (!source.active) throw new Error("La etapa ya no está pendiente; no se puede asignar")
  if (!canAccessWorksite(session, source.worksiteId)) throw new Error("No tienes acceso a la faena de este pendiente")

  if (input.assigneeUserId) {
    const eligibleIds = await getUserIdsWithPermissionForWorksite(source.permission, source.worksiteId)
    if (!eligibleIds.includes(input.assigneeUserId)) throw new Error("La persona seleccionada no está activa, no tiene acceso a la faena o no puede ejecutar esta etapa")
  }

  await db.transaction(async (tx) => {
    const current = await tx.query.workItemAssignments.findFirst({
      where: and(eq(workItemAssignments.sourceType, input.sourceType), eq(workItemAssignments.sourceId, input.sourceId), eq(workItemAssignments.actionKey, input.actionKey)),
    })
    const now = new Date().toISOString()
    const values = {
      assigneeUserId: input.assigneeUserId,
      assignedByUserId: session.user.id,
      committedDueAt: input.committedDueAt,
      updatedAt: now,
    }
    if (current) {
      await tx.update(workItemAssignments).set(values).where(eq(workItemAssignments.id, current.id))
    } else {
      await tx.insert(workItemAssignments).values({ id: nanoid(), sourceType: input.sourceType, sourceId: input.sourceId, actionKey: input.actionKey, worksiteId: source.worksiteId, createdAt: now, ...values })
    }
    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined, action: current ? "update" : "create",
      entityType: "work_item_assignment", entityId: `${input.sourceType}:${input.sourceId}:${input.actionKey}`, entityCode: source.entityCode ?? undefined,
      oldState: current ? { assigneeUserId: current.assigneeUserId, committedDueAt: current.committedDueAt } : undefined,
      newState: { assigneeUserId: input.assigneeUserId, committedDueAt: input.committedDueAt, worksiteId: source.worksiteId },
    }, tx)
    await recordOperationalActivity({
      eventType: input.assigneeUserId ? (current?.assigneeUserId ? "work.reassigned" : "work.assigned") : "work.unassigned",
      module: "operaciones", entityType: "work_item_assignment", entityId: `${input.sourceType}:${input.sourceId}:${input.actionKey}`,
      entityCode: source.entityCode, worksiteId: source.worksiteId, actorUserId: session.user.id, actorSnapshot: session.user.name ?? null,
      payload: { sourceType: input.sourceType, actionKey: input.actionKey, hasAssignee: Boolean(input.assigneeUserId) },
    }, tx)
  })
}
