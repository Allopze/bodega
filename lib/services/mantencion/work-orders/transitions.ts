import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantDrivers, mantRecords, mantWorkOrderEvents, mantWorkOrderItems, mantWorkOrders, mantWorkshops } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import {
  OT_ITEM_MAX_PER_KIND, OT_TRANSITIONS, type OtItemDone, type OtItemKind, type OtTransition,
} from "@/lib/mantencion/work-order-states"
import type { EditWorkOrderInput } from "@/lib/mantencion/work-order-schemas"
import { REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { todayInChile } from "@/lib/utils"
import {
  canActOnWorkOrder, canEditExecution, canEditRequest, inWorksiteScope, type AccessCheck,
} from "./access"
import { activateWorkOrderCapaEvidence, supersedeWorkOrderCapaEvidence } from "./capa-link"
import { applyChange, assertNotFuture, planFor, refuse, runLocked, type LockedResult, type OtRow } from "./core"
import { checkRequestFields, itemRows, normalizeItems } from "./create"
import { findAssignableMechanic } from "./mechanics"
import { markVehicleInWorkshop, markVehicleOutOfWorkshop } from "./vehicle-status"
import type { WorkOrderActor } from "./types"

/**
 * Una función por transición de la OT. Todas siguen el mismo patrón
 * (`runLocked`): bloquear el equipo y luego la OT, comprobar la versión que la
 * web esperaba, comprobar permiso + regla de actor + alcance
 * (`canActOnWorkOrder`), aplicar el cambio con `version + 1`, dejar el evento y
 * la bitácora, y devolver los avisos para enviarlos DESPUÉS del commit.
 *
 * La web manda `expectedVersion` (si otra sesión cambió la OT, se responde «La
 * OT cambió en otra sesión»); el teléfono no la manda: guarda el estado bajo
 * bloqueo y rechaza lo que ya no corresponde. `clientOpId` es la clave de
 * idempotencia de las operaciones del teléfono (`mant_work_order_events`).
 */

export interface Base {
  workOrderId: string
  expectedVersion?: number
  /** Operación del teléfono: queda en el evento principal y hace idempotente el reenvío. */
  clientOpId?: string
}

const nowIso = () => new Date().toISOString()

function assertAct(check: AccessCheck): void {
  if (!check.ok) refuse(check.message, check.code)
}

function assertReason(transition: OtTransition, reason: string | null | undefined): string {
  const text = (reason ?? "").trim()
  if (OT_TRANSITIONS[transition].requiresReason && text.length < REASON_MIN_LENGTH) {
    refuse(`Escribe un motivo de al menos ${REASON_MIN_LENGTH} caracteres.`, "invalid", "reason")
  }
  return text
}

// ── Asignación ──────────────────────────────────────────────────────────────

/** Asigna, reasigna (también en taller) o desasigna a un mecánico: sólo `mant:ot:manage`. */
export async function assignWorkOrder(actor: WorkOrderActor, input: Base & { assignedToUserId: string }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "assign"))
    if (!(await findAssignableMechanic(ctx.tx, input.assignedToUserId))) {
      refuse("Ese mecánico no existe, está inactivo o no puede ejecutar órdenes de trabajo.", "invalid", "assignedToUserId")
    }
    // `assigneeChanged` se calcula bajo bloqueo: asignar a quien ya la tiene no deja evento ni aviso.
    if (ctx.ot.assignedToUserId === input.assignedToUserId) return { row: ctx.ot }
    const target = ctx.ot.status === "solicitada" ? "asignada" : ctx.ot.status
    const row = await applyChange(ctx, {
      status: target,
      assignedToUserId: input.assignedToUserId,
      assignedByUserId: actor.userId,
      assignedAt: nowIso(),
    }, [{ type: "assigned", changeSet: { from: ctx.ot.assignedToUserId, to: input.assignedToUserId }, clientOpId: input.clientOpId }])
    return { row, notify: [planFor(row, "assigned", actor)] }
  })
}

/** Devuelve la OT a «por asignar» (sólo desde «asignada», antes del ingreso a taller). */
export async function unassignWorkOrder(actor: WorkOrderActor, input: Base): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "unassign"))
    const row = await applyChange(ctx, {
      status: "solicitada",
      assignedToUserId: null,
      assignedByUserId: null,
      assignedAt: null,
    }, [{ type: "unassigned", changeSet: { from: ctx.ot.assignedToUserId }, clientOpId: input.clientOpId }])
    return { row }
  })
}

/**
 * El mecánico toma una OT «por asignar» de CUALQUIER faena. Bajo `FOR UPDATE`
 * decide quién gana: dos «tomar» simultáneos dejan uno solo. Una faena distinta
 * a la suya sólo queda marcada (`outOfWorksite`) en el evento.
 */
export async function takeWorkOrder(actor: WorkOrderActor, input: Base): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    if (ctx.ot.status !== "solicitada" && actor.permissions.includes(OT_TRANSITIONS.take.permission)) {
      refuse("Esta OT ya no está por asignar: alguien la tomó o la asignó antes que tú.", "conflict")
    }
    assertAct(canActOnWorkOrder(actor, ctx.ot, "take"))
    const row = await applyChange(ctx, {
      status: "asignada",
      assignedToUserId: actor.userId,
      assignedByUserId: actor.userId,
      assignedAt: nowIso(),
    }, [{ type: "taken", changeSet: { outOfWorksite: !inWorksiteScope(actor, ctx.ot.worksiteId) }, clientOpId: input.clientOpId }])
    return { row }
  })
}

// ── Ingreso a taller ────────────────────────────────────────────────────────

interface EntryFields {
  workshopKind: "interno" | "externo"
  workshopId: string | null
  workshopName: string
  workshopManagerName: string | null
  operatorDriverId: string | null
  operatorName: string | null
  workshopEntryAt: string
  entryOdometer: number | null
  entryHourmeter: number | null
  estimatedDeliveryDate: string
}

/** Valida el INGRESO A TALLER y resuelve los nombres (snapshot) del taller y del operador. */
async function resolveEntry(tx: Tx, ot: OtRow, entry: WorkOrderEntryPayload): Promise<EntryFields> {
  const unit = ot.equipmentSnapshot.unit
  // La lectura que vale es la de la unidad del equipo: km → odómetro, h → horómetro.
  const reading = unit === "km" ? entry.odometer : entry.hourmeter
  if (reading === null || reading === undefined) {
    refuse(unit === "km" ? "Falta el kilometraje de ingreso." : "Faltan las horas del horómetro de ingreso.", "invalid", unit === "km" ? "odometer" : "hourmeter")
  }
  assertNotFuture(entry.entryAt, "La fecha y hora de ingreso no pueden ser futuras.", "entryAt")
  if (entry.estimatedDeliveryDate < todayInChile(entry.entryAt)) {
    refuse("La fecha estimada de entrega no puede ser anterior al ingreso.", "invalid", "estimatedDeliveryDate")
  }

  let workshopId: string | null = null
  let workshopName = "Taller interno"
  if (entry.workshopKind === "externo") {
    if (!entry.workshopId) refuse("Elige el taller externo.", "invalid", "workshopId")
    const [workshop] = await tx
      .select({ id: mantWorkshops.id, name: mantWorkshops.name })
      .from(mantWorkshops)
      .where(and(eq(mantWorkshops.id, entry.workshopId), eq(mantWorkshops.isActive, true)))
      .limit(1)
    if (!workshop) refuse("Ese taller ya no está disponible. Actualiza y vuelve a elegirlo.", "invalid", "workshopId")
    workshopId = workshop.id
    workshopName = workshop.name
  }

  let operatorName = entry.operatorName?.trim() || null
  if (entry.operatorDriverId) {
    const [driver] = await tx
      .select({ name: mantDrivers.name })
      .from(mantDrivers)
      .where(and(eq(mantDrivers.id, entry.operatorDriverId), eq(mantDrivers.isActive, true)))
      .limit(1)
    if (!driver) refuse("Ese operador ya no está disponible. Actualiza y vuelve a elegirlo.", "invalid", "operatorDriverId")
    operatorName = driver.name
  }

  return {
    workshopKind: entry.workshopKind,
    workshopId,
    workshopName,
    workshopManagerName: entry.workshopManagerName?.trim() || null,
    operatorDriverId: entry.operatorDriverId,
    operatorName,
    workshopEntryAt: new Date(entry.entryAt).toISOString(),
    entryOdometer: unit === "km" ? reading : null,
    entryHourmeter: unit === "h" ? reading : null,
    estimatedDeliveryDate: entry.estimatedDeliveryDate,
  }
}

/** «Ingreso a taller»: asignada → en_ejecucion. El equipo pasa a `mantencion` sólo si hoy está `operativo`. */
export async function startWorkOrder(actor: WorkOrderActor, input: Base & { entry: WorkOrderEntryPayload }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "start"))
    const fields = await resolveEntry(ctx.tx, ctx.ot, input.entry)
    const row = await applyChange(ctx, {
      status: "en_ejecucion",
      ...fields,
      startedByUserId: actor.userId,
      startedAt: nowIso(),
    }, [{ type: "started", changeSet: { ...fields }, clientOpId: input.clientOpId }])
    await markVehicleInWorkshop(ctx.tx, { vehicleId: row.vehicleId, folio: row.folio, actorUserId: actor.userId })
    return { row }
  })
}

const ENTRY_KEYS = [
  "workshopKind", "workshopId", "workshopName", "workshopManagerName", "operatorDriverId", "operatorName",
  "workshopEntryAt", "entryOdometer", "entryHourmeter",
] as const satisfies ReadonlyArray<keyof EntryFields>

/** Corrige el ingreso ya registrado. La fecha estimada tiene su propia acción (lleva motivo e historial). */
export async function updateWorkOrderEntry(actor: WorkOrderActor, input: Base & { entry: WorkOrderEntryPayload }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canEditExecution(actor, ctx.ot))
    if (input.entry.estimatedDeliveryDate !== ctx.ot.estimatedDeliveryDate) {
      refuse("Para cambiar la fecha estimada de entrega usa «Cambiar fecha estimada»: lleva un motivo y queda en el historial.", "invalid", "estimatedDeliveryDate")
    }
    const fields = await resolveEntry(ctx.tx, ctx.ot, input.entry)
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of ENTRY_KEYS) {
      const previous = ctx.ot[key]
      const next = fields[key]
      const same = key === "workshopEntryAt" ? new Date(previous as string).getTime() === new Date(next as string).getTime() : previous === next
      if (!same) { before[key] = previous; after[key] = next }
    }
    if (Object.keys(after).length === 0) return { row: ctx.ot }
    const { estimatedDeliveryDate: _unchanged, ...patch } = fields
    const row = await applyChange(ctx, patch, [{ type: "entry_updated", changeSet: { before, after }, clientOpId: input.clientOpId }])
    return { row }
  })
}

/** Cambia la «Fec. estimada entrega» de una OT en taller: motivo obligatorio y queda `{from, to}` en el historial. */
export async function changeWorkOrderEstimate(
  actor: WorkOrderActor,
  input: Base & { estimatedDeliveryDate: string; reason: string | null },
): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canEditExecution(actor, ctx.ot))
    const current = ctx.ot.estimatedDeliveryDate
    if (current === input.estimatedDeliveryDate) return { row: ctx.ot }
    const entryDay = ctx.ot.workshopEntryAt ? todayInChile(ctx.ot.workshopEntryAt) : null
    if (entryDay && input.estimatedDeliveryDate < entryDay) {
      refuse("La fecha estimada de entrega no puede ser anterior al ingreso.", "invalid", "estimatedDeliveryDate")
    }
    const reason = (input.reason ?? "").trim()
    if (reason.length < 5) refuse("Cuenta por qué cambia la fecha estimada (al menos 5 caracteres).", "invalid", "reason")
    const row = await applyChange(ctx, { estimatedDeliveryDate: input.estimatedDeliveryDate }, [
      { type: "estimate_changed", reason, changeSet: { from: current, to: input.estimatedDeliveryDate }, clientOpId: input.clientOpId },
    ])
    return { row }
  })
}

// ── Ítems SÍ/NO ─────────────────────────────────────────────────────────────

export interface MarkItemsInput extends Base {
  marks: Array<{ itemId: string; done: OtItemDone; note: string | null }>
  added: Array<{ id?: string; kind: OtItemKind; description: string }>
}

/** Marca SÍ/NO los ítems pedidos y agrega los que el taller encontró (máx. 12 por lista). */
export async function markWorkOrderItems(actor: WorkOrderActor, input: MarkItemsInput): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canEditExecution(actor, ctx.ot))
    if (input.marks.length === 0 && input.added.length === 0) refuse("No hay nada que guardar en los ítems.", "invalid", "marks")
    const items = await ctx.tx.select().from(mantWorkOrderItems).where(eq(mantWorkOrderItems.workOrderId, ctx.ot.id))
    const byId = new Map(items.map((item) => [item.id, item]))

    for (const mark of input.marks) {
      if (!byId.has(mark.itemId)) refuse("Un ítem ya no existe en esta OT. Recarga y vuelve a marcar.", "invalid", "marks")
    }
    const addedClean = input.added.map((entry) => ({ ...entry, description: entry.description.trim() }))
    const foreignIds = addedClean.map((entry) => entry.id).filter((id): id is string => !!id && !byId.has(id))
    if (foreignIds.length) {
      const taken = await ctx.tx.select({ id: mantWorkOrderItems.id }).from(mantWorkOrderItems).where(inArray(mantWorkOrderItems.id, foreignIds))
      if (taken.length) refuse("Ese ítem ya pertenece a otra orden de trabajo.", "invalid", "added")
    }
    // Un ítem agregado que ya estaba (mismo id) es un reenvío: no se duplica.
    const fresh = addedClean.filter((entry) => !entry.id || !byId.has(entry.id))
    for (const kind of ["anexo", "mantencion"] as const) {
      const count = items.filter((item) => item.kind === kind).length + fresh.filter((entry) => entry.kind === kind).length
      if (count > OT_ITEM_MAX_PER_KIND) refuse(`Máximo ${OT_ITEM_MAX_PER_KIND} ítems por lista, como el talonario.`, "invalid", "added")
    }

    const markedAt = nowIso()
    for (const mark of input.marks) {
      await ctx.tx.update(mantWorkOrderItems).set({
        done: mark.done, note: mark.note?.trim() || null, markedByUserId: actor.userId, markedAt,
      }).where(eq(mantWorkOrderItems.id, mark.itemId))
    }
    const rows = fresh.map((entry, index) => {
      const sameKind = items.filter((item) => item.kind === entry.kind)
      const sortOrder = Math.max(-1, ...sameKind.map((item) => item.sortOrder)) + 1 + fresh.slice(0, index).filter((other) => other.kind === entry.kind).length
      return {
        id: entry.id ?? nanoid(), workOrderId: ctx.ot.id, kind: entry.kind, origin: "taller" as const,
        description: entry.description, sortOrder, createdByUserId: actor.userId,
      }
    })
    if (rows.length) await ctx.tx.insert(mantWorkOrderItems).values(rows)

    const events: Array<{ type: "items_marked" | "item_added"; changeSet: Record<string, unknown>; clientOpId?: string }> = []
    if (input.marks.length) {
      events.push({
        type: "items_marked",
        changeSet: { marks: input.marks.map((mark) => ({ itemId: mark.itemId, description: byId.get(mark.itemId)?.description, done: mark.done, note: mark.note })) },
      })
    }
    if (rows.length) events.push({ type: "item_added", changeSet: { added: rows.map((row) => ({ id: row.id, kind: row.kind, description: row.description })) } })
    if (events.length === 0) return { row: ctx.ot }
    // Un solo evento lleva la clave de la operación; los demás cuelgan de ella.
    const tagged = events.map((event, index) => ({
      ...event,
      clientOpId: input.clientOpId ? (index === 0 ? input.clientOpId : `${input.clientOpId}#${event.type}`) : undefined,
    }))
    const row = await applyChange(ctx, {}, tagged)
    return { row }
  })
}

// ── Salida de taller ────────────────────────────────────────────────────────

/** Último momento en que la OT volvió a ejecución (rechazo o reapertura): lo firmado desde ahí cuenta para terminar. */
async function lastReturnToExecution(tx: Tx, workOrderId: string): Promise<string | null> {
  const [row] = await tx
    .select({ createdAt: mantWorkOrderEvents.createdAt })
    .from(mantWorkOrderEvents)
    .where(and(eq(mantWorkOrderEvents.workOrderId, workOrderId), inArray(mantWorkOrderEvents.type, ["rejected", "reopened"])))
    .orderBy(desc(mantWorkOrderEvents.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

/**
 * «Salida taller»: en_ejecucion → trabajo_terminado. Exige todos los ítems
 * marcados y al menos un registro VIGENTE enlazado y firmado después de la
 * última devolución a ejecución (un rechazo o una reapertura); sin rechazo
 * basta cualquiera, porque enlazar ya exige que la OT esté en ejecución.
 */
export async function finishWorkOrder(actor: WorkOrderActor, input: Base & { exitAt: string; note: string | null }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "finish"))
    const [pending] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mantWorkOrderItems)
      .where(and(eq(mantWorkOrderItems.workOrderId, ctx.ot.id), isNull(mantWorkOrderItems.done)))
    if ((pending?.count ?? 0) > 0) {
      refuse(`Marca SÍ o NO en todos los ítems antes de terminar (faltan ${pending?.count}).`, "invalid", "items")
    }
    const since = await lastReturnToExecution(ctx.tx, ctx.ot.id)
    const [linked] = await ctx.tx
      .select({ id: mantRecords.id })
      .from(mantRecords)
      .where(and(
        eq(mantRecords.workOrderId, ctx.ot.id),
        eq(mantRecords.status, "vigente"),
        since ? sql`${mantRecords.signedAt} > ${since}::timestamptz` : undefined,
      ))
      .limit(1)
    if (!linked) {
      refuse(
        since
          ? "Tras la devolución, registra una correctiva o preventiva nueva desde esta OT antes de terminar."
          : "Registra al menos una correctiva o preventiva desde esta OT antes de terminar.",
        "invalid",
        "records",
      )
    }
    const exitAt = new Date(input.exitAt)
    if (ctx.ot.workshopEntryAt && exitAt.getTime() < new Date(ctx.ot.workshopEntryAt).getTime()) {
      refuse("La salida de taller no puede ser anterior al ingreso.", "invalid", "exitAt")
    }
    assertNotFuture(input.exitAt, "La fecha y hora de salida no pueden ser futuras.", "exitAt")
    const note = input.note?.trim() || null
    const row = await applyChange(ctx, {
      status: "trabajo_terminado",
      workshopExitAt: exitAt.toISOString(),
      finishedByUserId: actor.userId,
      finishedAt: nowIso(),
    }, [{ type: "finished", reason: note, changeSet: { exitAt: exitAt.toISOString(), rejectionCount: ctx.ot.rejectionCount }, clientOpId: input.clientOpId }])
    await markVehicleOutOfWorkshop(ctx.tx, { vehicleId: row.vehicleId, folio: row.folio, workOrderId: row.id, actorUserId: actor.userId })
    return { row, notify: [planFor(row, "finished", actor)] }
  })
}

// ── Recepciones ─────────────────────────────────────────────────────────────

/** «Recepción»: quien retira el equipo del taller (jefatura de mantención o administración de contrato). */
export async function receiveWorkOrder(actor: WorkOrderActor, input: Base & { receivedAt: string; receiverName: string }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "receive"))
    const receiverName = input.receiverName.trim()
    if (receiverName.length < 2) refuse("Indica el nombre de quien recibe.", "invalid", "receiverName")
    const receivedAt = new Date(input.receivedAt)
    if (ctx.ot.workshopExitAt && receivedAt.getTime() < new Date(ctx.ot.workshopExitAt).getTime()) {
      refuse("La recepción no puede ser anterior a la salida de taller.", "invalid", "receivedAt")
    }
    assertNotFuture(input.receivedAt, "La fecha y hora de recepción no pueden ser futuras.", "receivedAt")
    const row = await applyChange(ctx, {
      status: "recepcionada",
      receivedAt: receivedAt.toISOString(),
      receiverName,
      receivedByUserId: actor.userId,
      receivedRecordedAt: nowIso(),
    }, [{ type: "received", changeSet: { receivedAt: receivedAt.toISOString(), receiverName }, clientOpId: input.clientOpId }])
    return { row, notify: [planFor(row, "received", actor)] }
  })
}

/** Lo que el rechazo y la reapertura limpian de la OT (los valores viejos quedan en el evento). */
const CLEARED = {
  workshopExitAt: null, finishedByUserId: null, finishedAt: null,
  receivedAt: null, receiverName: null, receivedByUserId: null, receivedRecordedAt: null,
  faenaReceivedAt: null, faenaReceiverName: null, faenaReceivedByUserId: null, closedAt: null,
} as const

function previousValues(ot: OtRow) {
  return {
    workshopExitAt: ot.workshopExitAt, finishedAt: ot.finishedAt,
    receivedAt: ot.receivedAt, receiverName: ot.receiverName,
    faenaReceivedAt: ot.faenaReceivedAt, faenaReceiverName: ot.faenaReceiverName,
  }
}

/**
 * Rechazo en la recepción (desde «por recibir») o en la conformidad (desde «por
 * conformidad»): el estado decide cuál. Vuelve a «en taller» con el mismo
 * mecánico, motivo obligatorio, `rejection_count + 1`, y limpia salida y
 * recepciones (los valores viejos quedan en el evento).
 */
export async function rejectWorkOrder(actor: WorkOrderActor, input: Base & { reason: string }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    const transition: OtTransition = ctx.ot.status === "recepcionada" ? "reject_conformity" : "reject_receipt"
    assertAct(canActOnWorkOrder(actor, ctx.ot, transition))
    const reason = assertReason(transition, input.reason)
    const row = await applyChange(ctx, {
      status: "en_ejecucion",
      rejectionCount: ctx.ot.rejectionCount + 1,
      ...CLEARED,
    }, [{
      type: "rejected",
      reason,
      changeSet: {
        stage: transition === "reject_conformity" ? "conformidad" : "recepcion",
        rejectionCount: ctx.ot.rejectionCount + 1,
        previous: previousValues(ctx.ot),
      },
      clientOpId: input.clientOpId,
    }])
    await markVehicleInWorkshop(ctx.tx, { vehicleId: row.vehicleId, folio: row.folio, actorUserId: actor.userId, reason: "Devuelta a taller" })
    return { row, notify: [planFor(row, "rejected", actor, reason)] }
  })
}

/**
 * «Recepción en faena» = conformidad: cierra la OT. La faena del equipo debe
 * ser del usuario (un rol global, cualquiera). Si la OT nació de un hallazgo de
 * inspección, acredita su CAPA y cierra el hallazgo en la misma transacción.
 */
export async function conformWorkOrder(actor: WorkOrderActor, input: Base & { faenaReceivedAt: string; faenaReceiverName: string }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "conform"))
    const receiverName = input.faenaReceiverName.trim()
    if (receiverName.length < 2) refuse("Indica el nombre de quien recibe en faena.", "invalid", "faenaReceiverName")
    const receivedAt = new Date(input.faenaReceivedAt)
    if (ctx.ot.receivedAt && receivedAt.getTime() < new Date(ctx.ot.receivedAt).getTime()) {
      refuse("La recepción en faena no puede ser anterior a la recepción del equipo.", "invalid", "faenaReceivedAt")
    }
    assertNotFuture(input.faenaReceivedAt, "La fecha y hora de la recepción en faena no pueden ser futuras.", "faenaReceivedAt")
    const closedAt = nowIso()
    const row = await applyChange(ctx, {
      status: "cerrada",
      faenaReceivedAt: receivedAt.toISOString(),
      faenaReceiverName: receiverName,
      faenaReceivedByUserId: actor.userId,
      closedAt,
    }, [{ type: "conformed", changeSet: { faenaReceivedAt: receivedAt.toISOString(), faenaReceiverName: receiverName }, clientOpId: input.clientOpId }])
    await activateWorkOrderCapaEvidence(ctx.tx, {
      workOrder: { id: row.id, folio: row.folio, inspectionFindingId: row.inspectionFindingId },
      actorUserId: actor.userId,
      conformedOn: todayInChile(receivedAt),
    })
    return { row, notify: [planFor(row, "closed", actor)] }
  })
}

// ── Anular y reabrir ────────────────────────────────────────────────────────

/** Anula la OT (jefatura, o quien la creó mientras sigue «por asignar»). Si estaba en taller, revierte el estado del equipo. */
export async function voidWorkOrder(actor: WorkOrderActor, input: Base & { reason: string }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "void"))
    const reason = assertReason("void", input.reason)
    const wasInWorkshop = ctx.ot.status === "en_ejecucion"
    const row = await applyChange(ctx, {
      status: "anulada",
      voidedByUserId: actor.userId,
      voidedAt: nowIso(),
      voidReason: reason,
    }, [{ type: "voided", reason, clientOpId: input.clientOpId }], { reason })
    if (wasInWorkshop) {
      await markVehicleOutOfWorkshop(ctx.tx, { vehicleId: row.vehicleId, folio: row.folio, workOrderId: row.id, actorUserId: actor.userId, reason: "OT anulada" })
    }
    return { row }
  })
}

/** Reabre una OT cerrada (jefatura): vuelve a taller, supersede la evidencia de la CAPA y el equipo vuelve a `mantencion`. */
export async function reopenWorkOrder(actor: WorkOrderActor, input: Base & { reason: string }): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canActOnWorkOrder(actor, ctx.ot, "reopen"))
    const reason = assertReason("reopen", input.reason)
    await supersedeWorkOrderCapaEvidence(ctx.tx, {
      workOrder: { id: ctx.ot.id, inspectionFindingId: ctx.ot.inspectionFindingId },
      actorUserId: actor.userId,
      reason,
    })
    const row = await applyChange(ctx, { status: "en_ejecucion", ...CLEARED }, [{
      type: "reopened", reason, changeSet: { previous: previousValues(ctx.ot) }, clientOpId: input.clientOpId,
    }], { reason })
    await markVehicleInWorkshop(ctx.tx, { vehicleId: row.vehicleId, folio: row.folio, actorUserId: actor.userId, reason: "Reabierta" })
    return { row, notify: [planFor(row, "reopened", actor, reason)] }
  })
}

// ── Editar la solicitud ─────────────────────────────────────────────────────

function summarize(ot: OtRow) {
  return {
    repair: ot.repair, maintenance: ot.maintenance, requestDate: ot.requestDate, requesterName: ot.requesterName,
    repairDescription: ot.repairDescription, observations: ot.observations,
  }
}

/** Edita la cabecera y los ítems pedidos mientras la OT está «por asignar» o «asignada». */
export async function editWorkOrderRequest(actor: WorkOrderActor, input: EditWorkOrderInput): Promise<LockedResult> {
  return runLocked(actor, input, async (ctx) => {
    assertAct(canEditRequest(actor, ctx.ot))
    checkRequestFields(input)
    const items = normalizeItems(input.annexItems, input.maintenanceItems)
    const patch = {
      repair: input.repair,
      maintenance: input.maintenance,
      requestDate: input.requestDate,
      requesterName: input.requesterName.trim(),
      repairDescription: input.repairDescription?.trim() || null,
      observations: input.observations?.trim() || null,
    }
    const previousItems = await ctx.tx.select({ kind: mantWorkOrderItems.kind, description: mantWorkOrderItems.description })
      .from(mantWorkOrderItems)
      .where(and(eq(mantWorkOrderItems.workOrderId, ctx.ot.id), eq(mantWorkOrderItems.origin, "solicitud")))
    await ctx.tx.delete(mantWorkOrderItems).where(and(eq(mantWorkOrderItems.workOrderId, ctx.ot.id), eq(mantWorkOrderItems.origin, "solicitud")))
    const rows = itemRows(ctx.ot.id, actor.userId, items)
    if (rows.length) await ctx.tx.insert(mantWorkOrderItems).values(rows)
    const row = await applyChange(ctx, patch, [{
      type: "edited",
      changeSet: {
        before: summarize(ctx.ot),
        after: patch,
        items: { before: previousItems, after: rows.map((item) => ({ kind: item.kind, description: item.description })) },
      },
    }])
    return { row }
  })
}
