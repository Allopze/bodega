import { eq } from "drizzle-orm"
import { db } from "@/db"
import { mantWorkOrderEvents, mantWorkOrders, worksites } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import type { SyncWarning, SyncWorkOrderResponse, WorkOrderOpPayload } from "@/lib/mantencion/contracts"
import { OT_PERMISSIONS, type OtStatus } from "@/lib/mantencion/work-order-states"
import type { SyncContext } from "../sync-auth"
import type { LockedResult } from "./core"
import {
  changeWorkOrderEstimate, finishWorkOrder, markWorkOrderItems, startWorkOrder, takeWorkOrder,
} from "./transitions"
import type { WorkOrderActor } from "./types"

/**
 * Operaciones del mecánico sobre una OT, enviadas desde el teléfono
 * (`POST /api/mantencion/sync/ot`): tomar, ingreso, fecha estimada, ítems SÍ/NO
 * y terminar.
 *
 * Idempotente por `op.id` (= `mant_work_order_events.client_op_id`): la misma
 * operación enviada tres veces deja UN evento. Un identificador que ya usó otra
 * persona se rechaza con 409. No hay `expectedVersion`: lo que el teléfono pide
 * se evalúa bajo bloqueo contra el estado real y se rechaza (409/422, definitivo)
 * si ya no corresponde, p. ej. «tomar» una OT que otro tomó primero.
 */

export interface WorkOrderOpOutcome {
  status: 200 | 409 | 422
  body: SyncWorkOrderResponse
}

const toIso = (value: string) => new Date(value).toISOString()
const refuse = (status: 409 | 422, message: string, field?: string): WorkOrderOpOutcome => ({
  status,
  body: { ok: false, code: "rejected", message, ...(field ? { field } : {}) },
})

interface AppliedOp {
  eventId: string
  actorUserId: string
  createdAt: string
  workOrderId: string
  status: string
}

async function findAppliedOp(opId: string): Promise<AppliedOp | null> {
  const [row] = await db
    .select({
      eventId: mantWorkOrderEvents.id,
      actorUserId: mantWorkOrderEvents.actorUserId,
      createdAt: mantWorkOrderEvents.createdAt,
      workOrderId: mantWorkOrderEvents.workOrderId,
      status: mantWorkOrders.status,
    })
    .from(mantWorkOrderEvents)
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantWorkOrderEvents.workOrderId))
    .where(eq(mantWorkOrderEvents.clientOpId, opId))
    .limit(1)
  return row ?? null
}

function appliedOutcome(op: WorkOrderOpPayload, applied: AppliedOp, userId: string): WorkOrderOpOutcome {
  if (applied.actorUserId !== userId) return refuse(409, "Ese identificador de operación ya pertenece a otra persona.")
  return {
    status: 200,
    body: { ok: true, id: op.id, workOrderId: applied.workOrderId, status: applied.status as OtStatus, receivedAt: toIso(applied.createdAt), duplicate: true, warnings: [] },
  }
}

async function dispatch(op: WorkOrderOpPayload, actor: WorkOrderActor): Promise<LockedResult> {
  const base = { workOrderId: op.workOrderId, clientOpId: op.id }
  switch (op.action) {
    case "take":
      return takeWorkOrder(actor, base)
    case "start":
      return startWorkOrder(actor, { ...base, entry: op.entry })
    case "estimate":
      return changeWorkOrderEstimate(actor, { ...base, estimatedDeliveryDate: op.estimatedDeliveryDate, reason: op.reason })
    case "items":
      return markWorkOrderItems(actor, { ...base, marks: op.marks, added: op.added })
    case "finish":
      return finishWorkOrder(actor, { ...base, exitAt: op.exitAt, note: op.note })
  }
}

/** Aviso (no bloqueo) cuando el mecánico trabaja un equipo de una faena que no es la suya. */
async function worksiteWarnings(op: WorkOrderOpPayload, context: SyncContext): Promise<SyncWarning[]> {
  if (op.action !== "take" && op.action !== "start") return []
  const { viewer } = context
  if (viewer.isGlobal) return []
  const [row] = await db
    .select({ worksiteId: mantWorkOrders.worksiteId, name: worksites.name })
    .from(mantWorkOrders)
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .where(eq(mantWorkOrders.id, op.workOrderId))
    .limit(1)
  if (!row || viewer.worksiteIds.includes(row.worksiteId)) return []
  return [{ code: "out_of_worksite", message: `El equipo es de otra faena (${row.name}): queda marcado para jefatura, puedes trabajarlo igual.` }]
}

export async function applyWorkOrderOp(op: WorkOrderOpPayload, context: SyncContext): Promise<WorkOrderOpOutcome> {
  const { viewer } = context
  if (!viewer.permissions.includes(OT_PERMISSIONS.execute)) {
    return refuse(422, "Tu cuenta no tiene permiso para ejecutar órdenes de trabajo. Habla con jefatura.")
  }

  // Reenvío habitual (respuesta perdida): se contesta sin abrir transacción ni bloquear nada.
  const already = await findAppliedOp(op.id)
  if (already) return appliedOutcome(op, already, viewer.userId)

  const actor: WorkOrderActor = {
    userId: viewer.userId,
    name: context.userName,
    permissions: viewer.permissions,
    worksiteIds: viewer.worksiteIds,
    isGlobal: viewer.isGlobal,
    deviceId: context.deviceId,
  }
  try {
    const result = await dispatch(op, actor)
    if (!result.ok) {
      return refuse(result.code === "conflict" ? 409 : 422, result.message, result.field)
    }
    const applied = await findAppliedOp(op.id)
    // `duplicate` aquí = otro envío idéntico confirmó entre la comprobación y el bloqueo.
    return {
      status: 200,
      body: {
        ok: true,
        id: op.id,
        workOrderId: result.value.id,
        status: result.value.status,
        receivedAt: toIso(applied?.createdAt ?? new Date().toISOString()),
        duplicate: !!result.duplicate,
        warnings: result.duplicate ? [] : await worksiteWarnings(op, context),
      },
    }
  } catch (error) {
    // Carrera por el índice único de `client_op_id`: otro envío de la misma operación confirmó primero.
    if (isUniqueViolation(error)) {
      const winner = await findAppliedOp(op.id)
      if (winner) return appliedOutcome(op, winner, viewer.userId)
    }
    throw error
  }
}
