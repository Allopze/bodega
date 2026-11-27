import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrderEvents, mantWorkOrders, worksites } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import type { SyncPartsNote, SyncPartsNoteResponse } from "@/lib/mantencion/contracts"
import { OT_PERMISSIONS, OT_STATUS_LABELS, isOtStatus } from "@/lib/mantencion/work-order-states"
import { notifyAfterCommit } from "@/lib/services/notification-create"
import { roundQty } from "@/lib/services/stock-reservations"
import { codeYear } from "@/lib/utils"
import type { MantViewer } from "../access"
import type { SyncContext } from "../sync-auth"
import { equipmentLabel, lockVehicle } from "../work-orders/core"
import { inWorksiteScope, NP_PERMISSIONS } from "./access"
import { findLineIssueTx, type NoteLineInput } from "./create-lines"
import { notifyPartsNoteCreated, type PartsNoteCreatedNotice } from "./notifications"
import { insertNoteEventTx } from "./set-status"

/**
 * Alta de una nota de pedido (NP) desde el teléfono (`POST /api/mantencion/sync/notas-pedido`, ADR mantención 0001 y
 * 2026-11-27). El alta desde la web (sin OT o con OT) es `create-manual.ts`, que usa las mismas comprobaciones de aquí.
 *
 * Con OT (lo de siempre): la faena es la de la OT y el equipo el de la OT. SIN OT (`worksiteId`, pedido de taller o
 * reposición): la faena la elige quien pide, sólo entre las de su alcance, y no hay equipo ni evento de OT. Las líneas
 * pueden traer cargo (equipo o centro de costo de esa faena) y proveedor sugerido, opcionales: los teléfonos viejos no los
 * mandan. `urgent`, si viene, manda; si no, vale `equipmentStopped`.
 *
 * Idempotente por `clientOpId` (= `mant_parts_notes.client_op_id`): la misma NP enviada tres veces deja UNA fila y devuelve
 * siempre el mismo folio. Si el id ya lo usó otra persona o se usó en otra orden, es un 409 y la NP NO se da por aplicada
 * (contestar 200 la borraría de la cola del teléfono sin haberse guardado).
 *
 * Orden de bloqueo: equipo → OT (`FOR SHARE`, como la recepción y la guía). Todo rechazo ocurre ANTES de escribir; el
 * folio se toma al final. Cada alta deja el evento `creada` del historial de la NP y la auditoría.
 */

export interface PartsNoteOutcome {
  status: number
  body: SyncPartsNoteResponse
}

/** Estados de la OT que admiten pedir repuestos: aún no hay trabajo terminado ni entrega. */
const ALLOWED_STATUSES: readonly string[] = ["asignada", "en_ejecucion"]

const toIso = (value: string) => new Date(value).toISOString()

/** Un rechazo de la regla, sin forma de respuesta: cada vía (teléfono o web) lo traduce a la suya. */
export interface NoteRejection {
  status: 403 | 409 | 422
  message: string
  field?: string
}

const refuse = (status: 403 | 409 | 422, message: string, field?: string): PartsNoteOutcome => ({
  status,
  body: { ok: false, code: status === 422 ? "invalid" : "rejected", message, ...(field ? { field } : {}) },
})

interface AppliedNote {
  id: string
  code: string
  workOrderId: string | null
  requestedByUserId: string | null
  createdAt: string
}

export async function findAppliedNote(client: Pick<Tx, "select">, opId: string): Promise<AppliedNote | null> {
  const [row] = await client
    .select({
      id: mantPartsNotes.id,
      code: mantPartsNotes.code,
      workOrderId: mantPartsNotes.workOrderId,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      createdAt: mantPartsNotes.createdAt,
    })
    .from(mantPartsNotes)
    .where(eq(mantPartsNotes.clientOpId, opId))
    .limit(1)
  return row ?? null
}

/** Mismo id de operación: ¿es la misma persona y la misma OT? Si sí, es un reenvío; si no, un choque. */
export function appliedConflict(applied: AppliedNote, input: { userId: string; workOrderId: string | null }): NoteRejection | null {
  if (applied.requestedByUserId !== input.userId) return { status: 409, message: "Ese identificador de operación ya pertenece a otra persona." }
  if ((applied.workOrderId ?? null) !== input.workOrderId) return { status: 409, message: "Ese identificador ya se usó en otra orden." }
  return null
}

function appliedOutcome(payload: SyncPartsNote, applied: AppliedNote, userId: string): PartsNoteOutcome {
  const conflict = appliedConflict(applied, { userId, workOrderId: payload.workOrderId ?? null })
  if (conflict) return refuse(conflict.status, conflict.message)
  return {
    status: 200,
    body: { ok: true, id: payload.id, noteId: applied.id, code: applied.code, receivedAt: toIso(applied.createdAt), duplicate: true },
  }
}

/** La faena de la NP y, si la hay, la OT y su equipo. Un rechazo sale como `refusal`. */
export type NoteTarget =
  | { refusal: NoteRejection }
  | { workOrderId: string | null; vehicleId: string | null; worksiteId: string; workOrderFolio: string | null; equipment: string }

/** OT del alta: la asignada a quien pide, o cualquiera de su alcance si quien pide administra las OT (`mant:ot:manage`). */
export async function targetOfWorkOrderTx(tx: Tx, viewer: MantViewer, workOrderId: string): Promise<NoteTarget> {
  const [ot] = await tx
    .select({
      id: mantWorkOrders.id,
      folio: mantWorkOrders.folio,
      status: mantWorkOrders.status,
      vehicleId: mantWorkOrders.vehicleId,
      worksiteId: mantWorkOrders.worksiteId,
      assignedToUserId: mantWorkOrders.assignedToUserId,
      equipmentSnapshot: mantWorkOrders.equipmentSnapshot,
    })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, workOrderId))
    .for("share")
    .limit(1)
  if (!ot) return { refusal: { status: 422, message: "Esa orden de trabajo no existe.", field: "workOrderId" } }

  if (!ALLOWED_STATUSES.includes(ot.status)) {
    const label = isOtStatus(ot.status) ? OT_STATUS_LABELS[ot.status] : ot.status
    return { refusal: { status: 409, message: `La orden ${ot.folio} está «${label}»: ya no admite pedir repuestos.`, field: "workOrderId" } }
  }
  if (ot.assignedToUserId !== viewer.userId) {
    if (!viewer.permissions.includes(OT_PERMISSIONS.manage)) {
      return { refusal: { status: 409, message: `La orden ${ot.folio} ya no está asignada a ti.`, field: "workOrderId" } }
    }
    // Quien administra las OT sin ser el asignado necesita la faena de la OT (o la actual del equipo) en su alcance.
    // El asignado no: la jefatura puede asignar a un mecánico de otra faena y la OT es SU trabajo.
    const [vehicle] = await tx.select({ worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles).where(eq(fuelVehicles.id, ot.vehicleId)).limit(1)
    if (!inWorksiteScope(viewer, ot.worksiteId) && !(vehicle && inWorksiteScope(viewer, vehicle.worksiteId))) {
      return { refusal: { status: 409, message: `La orden ${ot.folio} es de una faena que no es de tu alcance.`, field: "workOrderId" } }
    }
  }
  return {
    workOrderId: ot.id,
    vehicleId: ot.vehicleId,
    worksiteId: ot.worksiteId,
    workOrderFolio: ot.folio,
    equipment: equipmentLabel(ot.equipmentSnapshot),
  }
}

/** Sin OT: la faena que elige quien pide, existente y dentro de su alcance. */
export async function targetOfWorksiteTx(tx: Tx, viewer: MantViewer, worksiteId: string): Promise<NoteTarget> {
  const [worksite] = await tx.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites).where(eq(worksites.id, worksiteId)).limit(1)
  if (!worksite) return { refusal: { status: 422, message: "Esa faena no existe.", field: "worksiteId" } }
  // Una faena cerrada ya no recibe pedidos (ni desde la web ni desde el teléfono): no hay quien los compre ni reciba. El formulario no la ofrece,
  // pero la regla es del servidor.
  if (!worksite.isActive) return { refusal: { status: 422, message: "Esa faena está cerrada: elige una faena activa.", field: "worksiteId" } }
  if (!inWorksiteScope(viewer, worksite.id)) return { refusal: { status: 403, message: "Esa faena no es de tu alcance.", field: "worksiteId" } }
  return { workOrderId: null, vehicleId: null, worksiteId: worksite.id, workOrderFolio: null, equipment: `Sin OT · ${worksite.name}` }
}

/** Escribe la NP, sus líneas, su evento `creada`, el evento de la OT (si la hay) y la auditoría. Dentro de la transacción. */
export async function insertPartsNoteTx(tx: Tx, input: {
  viewer: MantViewer
  deviceId: string | null
  clientOpId: string
  target: Extract<NoteTarget, { worksiteId: string }>
  lines: ReadonlyArray<NoteLineInput & { unitOfMeasure: string }>
  equipmentStopped: boolean
  urgent: boolean
  notes: string | null
}): Promise<{ noteId: string; code: string; now: string }> {
  const now = new Date().toISOString()
  const code = await nextCodeTx(tx, "NP", codeYear())
  const noteId = nanoid()
  const target = input.target
  await tx.insert(mantPartsNotes).values({
    id: noteId,
    code,
    workOrderId: target.workOrderId,
    vehicleId: target.vehicleId,
    worksiteId: target.worksiteId,
    requestedByUserId: input.viewer.userId,
    deviceId: input.deviceId,
    clientOpId: input.clientOpId,
    equipmentStopped: input.equipmentStopped,
    urgent: input.urgent,
    notes: input.notes,
    status: "enviada",
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(mantPartsNoteItems).values(input.lines.map((line, index) => ({
    id: nanoid(),
    noteId,
    description: line.description,
    quantity: roundQty(line.quantity),
    unitOfMeasure: line.unitOfMeasure,
    partNumber: line.partNumber || null,
    productId: line.productId ?? null,
    chargeVehicleId: line.chargeVehicleId ?? null,
    chargeCostCenterId: line.chargeCostCenterId ?? null,
    suggestedSupplierId: line.suggestedSupplierId ?? null,
    supplierHint: line.supplierHint || null,
    sortOrder: index,
    createdAt: now,
  })))
  await insertNoteEventTx(tx, { noteId, kind: "creada", fromStatus: null, toStatus: "enviada", actorUserId: input.viewer.userId })
  // Sin `client_op_id` en el evento de la OT: ese índice es único global y la idempotencia de la NP vive en la NP.
  if (target.workOrderId) {
    await tx.insert(mantWorkOrderEvents).values({
      id: nanoid(),
      workOrderId: target.workOrderId,
      type: "parts_note_created",
      changeSet: { noteId, code, lines: input.lines.length, equipmentStopped: input.equipmentStopped },
      actorUserId: input.viewer.userId,
      deviceId: input.deviceId,
    })
  }
  await recordAudit({
    userId: input.viewer.userId,
    userEmail: input.viewer.email ?? undefined,
    action: "create",
    entityType: "mant_parts_note",
    entityId: noteId,
    entityCode: code,
    newState: { workOrderId: target.workOrderId, workOrderFolio: target.workOrderFolio, lines: input.lines.length, equipmentStopped: input.equipmentStopped, urgent: input.urgent },
    worksiteId: target.worksiteId,
  }, tx)
  return { noteId, code, now }
}

async function createInTransaction(tx: Tx, payload: SyncPartsNote, context: SyncContext, vehicleId: string | null): Promise<Created> {
  const { viewer } = context
  if (vehicleId) await lockVehicle(tx, vehicleId)
  const raced = await findAppliedNote(tx, payload.id)
  if (raced) return { outcome: appliedOutcome(payload, raced, viewer.userId) }

  const target = payload.workOrderId
    ? await targetOfWorkOrderTx(tx, viewer, payload.workOrderId)
    : payload.worksiteId
      ? await targetOfWorksiteTx(tx, viewer, payload.worksiteId)
      : { refusal: { status: 422 as const, message: "Indica la orden de trabajo o la faena de la nota.", field: "worksiteId" } }
  if ("refusal" in target) return { outcome: refuse(target.refusal.status, target.refusal.message, target.refusal.field) }

  const invalid = await findLineIssueTx(tx, payload.lines, target.worksiteId)
  if (invalid) return { outcome: refuse(422, invalid.message, invalid.field) }

  const urgent = payload.urgent ?? payload.equipmentStopped
  const written = await insertPartsNoteTx(tx, {
    viewer,
    deviceId: context.deviceId,
    clientOpId: payload.id,
    target,
    lines: payload.lines,
    equipmentStopped: payload.equipmentStopped,
    urgent,
    notes: payload.notes || null,
  })
  return {
    outcome: { status: 200, body: { ok: true, id: payload.id, noteId: written.noteId, code: written.code, receivedAt: toIso(written.now), duplicate: false } },
    notice: {
      noteId: written.noteId,
      code: written.code,
      workOrderFolio: target.workOrderFolio,
      worksiteId: target.worksiteId,
      lineCount: payload.lines.length,
      equipmentStopped: payload.equipmentStopped,
      urgent,
      equipment: target.equipment,
      actorUserId: viewer.userId,
    },
  }
}

type Created = { outcome: PartsNoteOutcome; notice?: PartsNoteCreatedNotice }

export async function createPartsNoteFromDevice(payload: SyncPartsNote, context: SyncContext): Promise<PartsNoteOutcome> {
  const { viewer } = context
  if (!viewer.permissions.includes(NP_PERMISSIONS.create)) {
    return refuse(403, "Tu cuenta no tiene permiso para pedir repuestos. Habla con jefatura.")
  }

  // Reenvío habitual (respuesta perdida): se contesta sin abrir transacción ni bloquear nada.
  const already = await findAppliedNote(db, payload.id)
  if (already) return appliedOutcome(payload, already, viewer.userId)

  let vehicleId: string | null = null
  if (payload.workOrderId) {
    const [head] = await db.select({ vehicleId: mantWorkOrders.vehicleId }).from(mantWorkOrders).where(eq(mantWorkOrders.id, payload.workOrderId)).limit(1)
    if (!head) return refuse(422, "Esa orden de trabajo no existe.", "workOrderId")
    vehicleId = head.vehicleId
  }

  let created: Created
  try {
    created = await db.transaction((tx) => createInTransaction(tx, payload, context, vehicleId))
  } catch (error) {
    // Carrera por el índice único de `client_op_id`: otro envío confirmó primero.
    if (isUniqueViolation(error)) {
      const winner = await findAppliedNote(db, payload.id)
      if (winner) return appliedOutcome(payload, winner, viewer.userId)
    }
    throw error
  }
  const { notice } = created
  if (notice) notifyAfterCommit(() => notifyPartsNoteCreated(notice))
  return created.outcome
}
