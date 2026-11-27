import { eq } from "drizzle-orm"
import { z } from "zod"
import { db, type Tx } from "@/db"
import { mantWorkOrders } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { MANT_PARTS_NOTE_MAX_LINES } from "@/lib/mantencion/contracts"
import { notifyAfterCommit } from "@/lib/services/notification-create"
import type { MantViewer } from "../access"
import { lockVehicle } from "../work-orders/core"
import { NP_PERMISSIONS } from "./access"
import { appliedConflict, findAppliedNote, insertPartsNoteTx, targetOfWorkOrderTx, targetOfWorksiteTx, type NoteTarget } from "./create"
import { findLineIssueTx } from "./create-lines"
import { notifyPartsNoteCreated, type PartsNoteCreatedNotice } from "./notifications"

/**
 * Alta de una nota de pedido (NP) desde la WEB (ADR 0001, 2026-11-27): con OT o SIN OT (pedido de taller, reposición).
 * Es la vía reutilizable de la UI y del importador: el mismo alcance, las mismas reglas de faena, equipo, cargo y
 * proveedor que el teléfono (`create.ts`), y el mismo evento `creada` y auditoría.
 *
 * - Permiso: `mant:np:create`. Sin OT, la faena debe estar en el alcance de quien pide. Con OT, quien pide debe ser el
 *   asignado a la OT o administrar las OT con la faena en su alcance (la misma regla del teléfono).
 * - Idempotente por `clientOpId`: el mismo id devuelve la misma NP (`duplicate: true`); un id usado por otra persona o
 *   en otra OT es un rechazo (no se da por aplicado).
 * - Orden de bloqueo: equipo (sólo con OT) → OT (`FOR SHARE`) → filas que escribe el alta. Todo rechazo ocurre antes de escribir.
 */

const idText = z.string().trim().min(1).max(64)

const lineSchema = z.object({
  description: z.string().trim().min(3, "Describe el repuesto (al menos 3 letras).").max(300),
  quantity: z.number({ message: "Indica la cantidad." }).positive("La cantidad debe ser mayor que cero.").max(100_000),
  unitOfMeasure: z.string().trim().min(1, "Indica la unidad.").max(40),
  partNumber: z.string().trim().max(80).nullish(),
  productId: idText.nullish(),
  chargeVehicleId: idText.nullish(),
  chargeCostCenterId: idText.nullish(),
  suggestedSupplierId: idText.nullish(),
  supplierHint: z.string().trim().max(120).nullish(),
})

const inputSchema = z.object({
  clientOpId: z.string().trim().min(8, "Identificador de operación inválido.").max(64),
  worksiteId: idText,
  workOrderId: idText.nullish(),
  urgent: z.boolean(),
  notes: z.string().trim().max(500).nullish(),
  lines: z.array(lineSchema).min(1, "Agrega al menos un repuesto.").max(MANT_PARTS_NOTE_MAX_LINES),
})

export interface CreatePartsNoteInput {
  /** Id de operación que genera quien crea la NP (idempotencia). */
  clientOpId: string
  /** Faena de la NP. Con OT debe ser la de la OT. */
  worksiteId: string
  /** Null o ausente: nota sin OT. */
  workOrderId?: string | null
  urgent: boolean
  notes?: string
  lines: Array<{
    description: string
    quantity: number
    unitOfMeasure: string
    partNumber?: string | null
    productId?: string | null
    chargeVehicleId?: string | null
    chargeCostCenterId?: string | null
    suggestedSupplierId?: string | null
    supplierHint?: string | null
  }>
}

export type CreatePartsNoteResult =
  | { ok: true; noteId: string; code: string; duplicate: boolean }
  | { ok: false; message: string; field?: string }

type Attempt =
  | { kind: "refused"; message: string; field?: string }
  | { kind: "created"; noteId: string; code: string; notice: PartsNoteCreatedNotice }

async function createAttempt(tx: Tx, viewer: MantViewer, data: z.infer<typeof inputSchema>): Promise<Attempt> {
  const workOrderId = data.workOrderId ?? null
  let target: NoteTarget
  if (workOrderId) {
    const [head] = await tx.select({ vehicleId: mantWorkOrders.vehicleId }).from(mantWorkOrders).where(eq(mantWorkOrders.id, workOrderId)).limit(1)
    if (!head) return { kind: "refused", message: "Esa orden de trabajo no existe.", field: "workOrderId" }
    await lockVehicle(tx, head.vehicleId)
    target = await targetOfWorkOrderTx(tx, viewer, workOrderId)
  } else {
    target = await targetOfWorksiteTx(tx, viewer, data.worksiteId)
  }
  if ("refusal" in target) return { kind: "refused", message: target.refusal.message, field: target.refusal.field }
  if (workOrderId && target.worksiteId !== data.worksiteId) {
    return { kind: "refused", message: "La faena elegida no es la de la orden de trabajo.", field: "worksiteId" }
  }

  const invalid = await findLineIssueTx(tx, data.lines, target.worksiteId)
  if (invalid) return { kind: "refused", message: invalid.message, field: invalid.field }

  const written = await insertPartsNoteTx(tx, {
    viewer,
    deviceId: null,
    clientOpId: data.clientOpId,
    target,
    lines: data.lines.map((line) => ({ ...line, unitOfMeasure: line.unitOfMeasure, partNumber: line.partNumber ?? null })),
    // Lo de «equipo detenido» es lo que reporta el teléfono; desde la web la urgencia es la que marca quien pide.
    equipmentStopped: false,
    urgent: data.urgent,
    notes: data.notes || null,
  })
  return {
    kind: "created",
    noteId: written.noteId,
    code: written.code,
    notice: {
      noteId: written.noteId,
      code: written.code,
      workOrderFolio: target.workOrderFolio,
      worksiteId: target.worksiteId,
      lineCount: data.lines.length,
      equipmentStopped: false,
      urgent: data.urgent,
      equipment: target.equipment,
      actorUserId: viewer.userId,
    },
  }
}

/** Da de alta una NP desde la web (con o sin OT). Ver la cabecera de este archivo para permisos, alcance e idempotencia. */
export async function createPartsNote(viewer: MantViewer, input: CreatePartsNoteInput): Promise<CreatePartsNoteResult> {
  if (!viewer.permissions.includes(NP_PERMISSIONS.create)) {
    return { ok: false, message: "No tienes permiso para pedir repuestos." }
  }
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, message: issue?.message ?? "Revisa los datos de la nota.", ...(issue?.path.length ? { field: issue.path.join(".") } : {}) }
  }
  const data = parsed.data
  const workOrderId = data.workOrderId ?? null

  // Reenvío (el formulario se mandó dos veces): la misma NP, sin tocar nada.
  const applied = await findAppliedNote(db, data.clientOpId)
  if (applied) {
    const conflict = appliedConflict(applied, { userId: viewer.userId, workOrderId })
    if (conflict) return { ok: false, message: conflict.message }
    return { ok: true, noteId: applied.id, code: applied.code, duplicate: true }
  }

  let attempt: Attempt
  try {
    attempt = await db.transaction((tx) => createAttempt(tx, viewer, data))
  } catch (error) {
    // Carrera por el índice único de `client_op_id`: otro envío confirmó primero.
    if (!isUniqueViolation(error)) throw error
    const winner = await findAppliedNote(db, data.clientOpId)
    if (!winner) throw error
    const conflict = appliedConflict(winner, { userId: viewer.userId, workOrderId })
    if (conflict) return { ok: false, message: conflict.message }
    return { ok: true, noteId: winner.id, code: winner.code, duplicate: true }
  }
  if (attempt.kind === "refused") return { ok: false, message: attempt.message, ...(attempt.field ? { field: attempt.field } : {}) }
  const notice = attempt.notice
  notifyAfterCommit(() => notifyPartsNoteCreated(notice))
  return { ok: true, noteId: attempt.noteId, code: attempt.code, duplicate: false }
}
