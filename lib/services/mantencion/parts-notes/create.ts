import { eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrderEvents, mantWorkOrders, products } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import type { SyncPartsNote, SyncPartsNoteResponse } from "@/lib/mantencion/contracts"
import { OT_PERMISSIONS, OT_STATUS_LABELS, isOtStatus } from "@/lib/mantencion/work-order-states"
import { notifyAfterCommit } from "@/lib/services/notification-create"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import { codeYear } from "@/lib/utils"
import type { SyncContext } from "../sync-auth"
import { equipmentLabel, lockVehicle } from "../work-orders/core"
import { inWorksiteScope, NP_PERMISSIONS } from "./access"
import { notifyPartsNoteCreated, type PartsNoteCreatedNotice } from "./notifications"

/**
 * Alta de una nota de pedido (NP) desde el teléfono
 * (`POST /api/mantencion/sync/notas-pedido`, ADR mantención 0001).
 *
 * Idempotente por `payload.id` (= `mant_parts_notes.client_op_id`): la misma NP
 * enviada tres veces deja UNA fila y devuelve siempre el mismo folio. Sigue la regla
 * de `work-orders/sync-ops.ts`: si el id ya lo usó otra persona o se usó en otra
 * orden, es un 409 y la NP NO se da por aplicada (contestar 200 la borraría de la
 * cola del teléfono sin haberse guardado).
 *
 * Orden de bloqueo: equipo → OT (`FOR SHARE`, como la recepción y la guía). Dos envíos
 * simultáneos del mismo equipo se serializan en el bloqueo del equipo: el segundo ve
 * al primero. Todo rechazo ocurre ANTES de escribir; el folio se toma al final.
 */

export interface PartsNoteOutcome {
  status: number
  body: SyncPartsNoteResponse
}

/** Estados de la OT que admiten pedir repuestos: aún no hay trabajo terminado ni entrega. */
const ALLOWED_STATUSES: readonly string[] = ["asignada", "en_ejecucion"]

const toIso = (value: string) => new Date(value).toISOString()

const refuse = (status: 403 | 409 | 422, message: string, field?: string): PartsNoteOutcome => ({
  status,
  body: { ok: false, code: status === 422 ? "invalid" : "rejected", message, ...(field ? { field } : {}) },
})

interface AppliedNote {
  id: string
  code: string
  workOrderId: string
  requestedByUserId: string
  createdAt: string
}

async function findAppliedNote(client: Pick<Tx, "select">, opId: string): Promise<AppliedNote | null> {
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

function appliedOutcome(payload: SyncPartsNote, applied: AppliedNote, userId: string): PartsNoteOutcome {
  if (applied.requestedByUserId !== userId) return refuse(409, "Ese identificador de operación ya pertenece a otra persona.")
  if (applied.workOrderId !== payload.workOrderId) return refuse(409, "Ese identificador ya se usó en otra orden.")
  return {
    status: 200,
    body: { ok: true, id: payload.id, noteId: applied.id, code: applied.code, receivedAt: toIso(applied.createdAt), duplicate: true },
  }
}

/** Cantidades que sobreviven al redondeo de centésimas y repuestos elegidos que siguen siendo repuestos activos del catálogo. */
async function validateLines(tx: Tx, payload: SyncPartsNote): Promise<PartsNoteOutcome | null> {
  for (const [index, line] of payload.lines.entries()) {
    if (toCents(line.quantity) <= 0) return refuse(422, `La cantidad de «${line.description}» debe ser mayor que cero.`, `lines.${index}.quantity`)
  }
  const productIds = [...new Set(payload.lines.map((line) => line.productId).filter((id): id is string => !!id))]
  if (productIds.length === 0) return null
  const rows = await tx
    .select({ id: products.id, isSparePart: products.isSparePart, isActive: products.isActive })
    .from(products)
    .where(inArray(products.id, productIds))
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const [index, line] of payload.lines.entries()) {
    if (!line.productId) continue
    const product = byId.get(line.productId)
    if (!product || !product.isSparePart || !product.isActive) {
      return refuse(422, `«${line.description}» ya no está en el catálogo de repuestos.`, `lines.${index}.productId`)
    }
  }
  return null
}

type Created = { outcome: PartsNoteOutcome; notice?: PartsNoteCreatedNotice }

async function createInTransaction(tx: Tx, payload: SyncPartsNote, context: SyncContext, vehicleId: string): Promise<Created> {
  const { viewer } = context
  await lockVehicle(tx, vehicleId)
  const raced = await findAppliedNote(tx, payload.id)
  if (raced) return { outcome: appliedOutcome(payload, raced, viewer.userId) }

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
    .where(eq(mantWorkOrders.id, payload.workOrderId))
    .for("share")
    .limit(1)
  if (!ot) return { outcome: refuse(422, "Esa orden de trabajo no existe.", "workOrderId") }

  if (!ALLOWED_STATUSES.includes(ot.status)) {
    const label = isOtStatus(ot.status) ? OT_STATUS_LABELS[ot.status] : ot.status
    return { outcome: refuse(409, `La orden ${ot.folio} está «${label}»: ya no admite pedir repuestos.`, "workOrderId") }
  }
  if (ot.assignedToUserId !== viewer.userId) {
    if (!viewer.permissions.includes(OT_PERMISSIONS.manage)) {
      return { outcome: refuse(409, `La orden ${ot.folio} ya no está asignada a ti.`, "workOrderId") }
    }
    // Quien administra las OT sin ser el asignado necesita la faena de la OT (o la actual del equipo) en su alcance.
    // El asignado no: la jefatura puede asignar a un mecánico de otra faena y la OT es SU trabajo.
    const [vehicle] = await tx.select({ worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles).where(eq(fuelVehicles.id, ot.vehicleId)).limit(1)
    if (!inWorksiteScope(viewer, ot.worksiteId) && !(vehicle && inWorksiteScope(viewer, vehicle.worksiteId))) {
      return { outcome: refuse(409, `La orden ${ot.folio} es de una faena que no es de tu alcance.`, "workOrderId") }
    }
  }

  const invalid = await validateLines(tx, payload)
  if (invalid) return { outcome: invalid }

  const now = new Date().toISOString()
  const code = await nextCodeTx(tx, "NP", codeYear())
  const noteId = nanoid()
  await tx.insert(mantPartsNotes).values({
    id: noteId,
    code,
    workOrderId: ot.id,
    vehicleId: ot.vehicleId,
    worksiteId: ot.worksiteId,
    requestedByUserId: viewer.userId,
    deviceId: context.deviceId,
    clientOpId: payload.id,
    equipmentStopped: payload.equipmentStopped,
    notes: payload.notes || null,
    status: "enviada",
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(mantPartsNoteItems).values(payload.lines.map((line, index) => ({
    id: nanoid(),
    noteId,
    description: line.description,
    quantity: roundQty(line.quantity),
    unitOfMeasure: line.unitOfMeasure,
    partNumber: line.partNumber || null,
    productId: line.productId,
    sortOrder: index,
    createdAt: now,
  })))
  // Sin `client_op_id` en el evento: ese índice es único global y la idempotencia de la NP vive en la NP.
  await tx.insert(mantWorkOrderEvents).values({
    id: nanoid(),
    workOrderId: ot.id,
    type: "parts_note_created",
    changeSet: { noteId, code, lines: payload.lines.length, equipmentStopped: payload.equipmentStopped },
    actorUserId: viewer.userId,
    deviceId: context.deviceId,
  })
  await recordAudit({
    userId: viewer.userId,
    userEmail: viewer.email ?? undefined,
    action: "create",
    entityType: "mant_parts_note",
    entityId: noteId,
    entityCode: code,
    newState: { workOrderId: ot.id, workOrderFolio: ot.folio, lines: payload.lines.length, equipmentStopped: payload.equipmentStopped },
    worksiteId: ot.worksiteId,
  }, tx)

  return {
    outcome: { status: 200, body: { ok: true, id: payload.id, noteId, code, receivedAt: toIso(now), duplicate: false } },
    notice: {
      noteId,
      code,
      workOrderFolio: ot.folio,
      worksiteId: ot.worksiteId,
      lineCount: payload.lines.length,
      equipmentStopped: payload.equipmentStopped,
      equipment: equipmentLabel(ot.equipmentSnapshot),
      actorUserId: viewer.userId,
    },
  }
}

export async function createPartsNoteFromDevice(payload: SyncPartsNote, context: SyncContext): Promise<PartsNoteOutcome> {
  const { viewer } = context
  if (!viewer.permissions.includes(NP_PERMISSIONS.create)) {
    return refuse(403, "Tu cuenta no tiene permiso para pedir repuestos. Habla con jefatura.")
  }

  // Reenvío habitual (respuesta perdida): se contesta sin abrir transacción ni bloquear nada.
  const already = await findAppliedNote(db, payload.id)
  if (already) return appliedOutcome(payload, already, viewer.userId)

  const [head] = await db.select({ vehicleId: mantWorkOrders.vehicleId }).from(mantWorkOrders).where(eq(mantWorkOrders.id, payload.workOrderId)).limit(1)
  if (!head) return refuse(422, "Esa orden de trabajo no existe.", "workOrderId")

  let created: Created
  try {
    created = await db.transaction((tx) => createInTransaction(tx, payload, context, head.vehicleId))
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
