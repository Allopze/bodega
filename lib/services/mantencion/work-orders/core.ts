import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelVehicles, mantRecords, mantWorkOrderEvents, mantWorkOrders, type MantEquipmentSnapshot } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import type { OtEventType, OtStatus } from "@/lib/mantencion/work-order-states"
import { lockAndLoadVehicle, type VehicleContext } from "../records-create-context"
import { dispatchWorkOrderNotifications, type NotificationPlan, type OtNotifyEvent } from "./notifications"
import type { WorkOrderActor, WorkOrderResult } from "./types"

/**
 * Núcleo común de las escrituras de la OT: el orden de bloqueo, el rechazo con
 * mensaje, el cambio con versión + evento + bitácora y el despacho de avisos.
 *
 * ORDEN DE BLOQUEO ÚNICO: equipo → OT. `createRecord` ya bloquea primero el
 * perfil del equipo (`mant_equipment_profiles`) y luego, para enlazar un
 * registro con su OT, la OT; si una transición bloqueara en otro orden, un
 * registro y un «terminar» simultáneos del mismo equipo podrían trabarse entre
 * sí. Por eso TODA escritura de la OT parte bloqueando el perfil del equipo.
 */

export type OtRow = typeof mantWorkOrders.$inferSelect

export type OtFailureCode = "not_found" | "forbidden" | "conflict" | "invalid"

/** Un rechazo con mensaje para el usuario. Lanzarlo dentro de la transacción la revierte. */
export class OtRefusal extends Error {
  constructor(message: string, readonly code: OtFailureCode = "invalid", readonly field?: string) {
    super(message)
    this.name = "OtRefusal"
  }
}

export function refuse(message: string, code: OtFailureCode = "invalid", field?: string): never {
  throw new OtRefusal(message, code, field)
}

export const STALE_MESSAGE = "La OT cambió en otra sesión. Recarga antes de continuar."

/** Margen para el reloj de un teléfono adelantado: una hora «futura» pasa hasta 5 minutos. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000

export function assertNotFuture(value: string, message: string, field: string) {
  if (new Date(value).getTime() > Date.now() + FUTURE_TOLERANCE_MS) refuse(message, "invalid", field)
}

export function failureOf(error: unknown): { ok: false; message: string; field?: string; code: OtFailureCode } | null {
  if (!(error instanceof OtRefusal)) return null
  return { ok: false, message: error.message, ...(error.field ? { field: error.field } : {}), code: error.code }
}

/** Bloquea el perfil del equipo (o, si ya no lo tiene, la fila de la flota) y lo lee. */
export async function lockVehicle(tx: Tx, vehicleId: string): Promise<VehicleContext | null> {
  const vehicle = await lockAndLoadVehicle(tx, vehicleId)
  if (!vehicle) await tx.select({ id: fuelVehicles.id }).from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).for("update")
  return vehicle
}

export function snapshotOf(vehicle: VehicleContext): MantEquipmentSnapshot {
  return {
    code: vehicle.code,
    plate: vehicle.plate,
    noPlate: vehicle.noPlate,
    type: vehicle.typeName,
    brand: vehicle.brandName,
    model: vehicle.model,
    year: vehicle.year,
    worksite: vehicle.worksiteName,
    unit: vehicle.unit,
  }
}

export const equipmentLabel = (snapshot: MantEquipmentSnapshot) => `${snapshot.code} · ${snapshot.type}`

export interface LockedContext {
  tx: Tx
  ot: OtRow
  /** `null` si el equipo ya no está en el módulo (la OT sigue existiendo). */
  vehicle: VehicleContext | null
  actor: WorkOrderActor
}

export interface StepOutcome {
  row: OtRow
  notify?: NotificationPlan[]
  /** La operación ya estaba aplicada (reenvío del teléfono): no se ejecutó nada. */
  duplicate?: boolean
}

/** Resultado de una transición: `duplicate` sólo lo usa la sincronización del teléfono. */
export type LockedResult = WorkOrderResult & { duplicate?: boolean }

export const resultOf = (row: OtRow): { id: string; version: number; status: OtStatus } => ({ id: row.id, version: row.version, status: row.status as OtStatus })

/**
 * Corre un paso sobre una OT existente: bloquea el equipo y luego la OT, comprueba
 * la versión esperada (sólo la web la manda) y ejecuta el paso; los avisos del
 * plan salen cuando la transacción ya confirmó. Un `OtRefusal` revierte todo y
 * vuelve como `{ ok: false }`.
 */
export async function runLocked(
  actor: WorkOrderActor,
  input: { workOrderId: string; expectedVersion?: number; clientOpId?: string },
  step: (ctx: LockedContext) => Promise<StepOutcome>,
): Promise<LockedResult> {
  const [head] = await db.select({ vehicleId: mantWorkOrders.vehicleId }).from(mantWorkOrders).where(eq(mantWorkOrders.id, input.workOrderId)).limit(1)
  if (!head) return { ok: false, message: "Esa orden de trabajo no existe.", code: "not_found" }
  let outcome: StepOutcome
  try {
    outcome = await db.transaction(async (tx) => {
      const vehicle = await lockVehicle(tx, head.vehicleId)
      const [ot] = await tx.select().from(mantWorkOrders).where(eq(mantWorkOrders.id, input.workOrderId)).for("update").limit(1)
      if (!ot) refuse("Esa orden de trabajo no existe.", "not_found")
      if (input.clientOpId) {
        // Reenvío de una operación del teléfono: con la OT bloqueada, el segundo envío ve al primero aquí.
        const [applied] = await tx
          .select({ actorUserId: mantWorkOrderEvents.actorUserId })
          .from(mantWorkOrderEvents)
          .where(eq(mantWorkOrderEvents.clientOpId, input.clientOpId))
          .limit(1)
        if (applied) {
          if (applied.actorUserId !== actor.userId) refuse("Ese identificador de operación ya pertenece a otra persona.", "conflict")
          return { row: ot, duplicate: true }
        }
      }
      if (input.expectedVersion !== undefined && ot.version !== input.expectedVersion) refuse(STALE_MESSAGE, "conflict")
      return step({ tx, ot, vehicle, actor })
    })
  } catch (error) {
    const failure = failureOf(error)
    if (failure) return failure
    throw error
  }
  dispatchWorkOrderNotifications(outcome.notify ?? [])
  return { ok: true, value: resultOf(outcome.row), ...(outcome.duplicate ? { duplicate: true } : {}) }
}

export interface EventSpec {
  type: OtEventType
  reason?: string | null
  changeSet?: Record<string, unknown> | null
  /** Clave de idempotencia de la operación del teléfono. */
  clientOpId?: string | null
}

type OtPatch = Partial<Omit<typeof mantWorkOrders.$inferInsert, "id" | "version" | "updatedAt">>

/**
 * Aplica el cambio: `UPDATE … version = version + 1, updated_at = now()` (el ETag
 * del catálogo lee `updated_at`), los eventos del historial y la bitácora, todo
 * en la transacción de la OT.
 */
export async function applyChange(
  ctx: LockedContext,
  patch: OtPatch,
  events: EventSpec[],
  audit: { action?: "update" | "status_change"; reason?: string | null } = {},
): Promise<OtRow> {
  const { tx, ot, actor } = ctx
  const [row] = await tx
    .update(mantWorkOrders)
    .set({ ...patch, version: sql`${mantWorkOrders.version} + 1`, updatedAt: sql`now()` })
    .where(eq(mantWorkOrders.id, ot.id))
    .returning()
  if (!row) throw new Error("No se pudo actualizar la orden de trabajo")
  const statusChanged = row.status !== ot.status
  await tx.insert(mantWorkOrderEvents).values(events.map((event) => ({
    id: nanoid(),
    workOrderId: ot.id,
    type: event.type,
    fromStatus: statusChanged ? ot.status : null,
    toStatus: statusChanged ? row.status : null,
    reason: event.reason ?? null,
    changeSet: event.changeSet ?? null,
    actorUserId: actor.userId,
    deviceId: actor.deviceId ?? null,
    clientOpId: event.clientOpId ?? null,
  })))
  await recordAudit({
    userId: actor.userId,
    action: audit.action ?? (statusChanged ? "status_change" : "update"),
    entityType: "mant_work_order",
    entityId: ot.id,
    entityCode: ot.folio,
    worksiteId: ot.worksiteId,
    oldState: { status: ot.status, version: ot.version },
    newState: { status: row.status, version: row.version, events: events.map((event) => event.type) },
    reason: audit.reason ?? undefined,
  }, tx)
  return row
}

/** Plan de aviso con los datos que casi todos los eventos repiten. */
export function planFor(row: OtRow, event: OtNotifyEvent, actor: Pick<WorkOrderActor, "userId">, detail?: string | null): NotificationPlan {
  return {
    event,
    workOrderId: row.id,
    folio: row.folio,
    worksiteId: row.worksiteId,
    version: row.version,
    actorUserId: actor.userId,
    requestedByUserId: row.requestedByUserId,
    assigneeUserId: row.assignedToUserId,
    equipment: equipmentLabel(row.equipmentSnapshot),
    detail: detail ?? null,
  }
}

type Reader = Pick<Tx, "select">

/** Último momento en que la OT volvió a ejecución (rechazo o reapertura): lo firmado desde ahí cuenta para terminar. */
export async function lastReturnToExecution(client: Reader, workOrderId: string): Promise<string | null> {
  const [row] = await client
    .select({ createdAt: mantWorkOrderEvents.createdAt })
    .from(mantWorkOrderEvents)
    .where(and(eq(mantWorkOrderEvents.workOrderId, workOrderId), inArray(mantWorkOrderEvents.type, ["rejected", "reopened"])))
    .orderBy(desc(mantWorkOrderEvents.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

/**
 * ¿La OT ya tiene el trabajo que exige «terminar»? Un registro VIGENTE enlazado
 * y firmado después de la última devolución a ejecución (sin devolución basta
 * cualquiera). La misma regla la usan `finishWorkOrder` (bajo bloqueo) y la
 * ficha, que con ella decide si «Registrar trabajo» es la acción de la etapa.
 */
export async function linkedRecordState(client: Reader, workOrderId: string): Promise<{ since: string | null; linked: boolean }> {
  const since = await lastReturnToExecution(client, workOrderId)
  const [linked] = await client
    .select({ id: mantRecords.id })
    .from(mantRecords)
    .where(and(
      eq(mantRecords.workOrderId, workOrderId),
      eq(mantRecords.status, "vigente"),
      since ? sql`${mantRecords.signedAt} > ${since}::timestamptz` : undefined,
    ))
    .limit(1)
  return { since, linked: !!linked }
}
