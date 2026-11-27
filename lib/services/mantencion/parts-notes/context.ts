import { asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Tx } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, worksites } from "@/db/schema"
import type { MantViewer } from "../access"
import type { PartsActionResult } from "../parts/types"
import { canManageNote } from "./access"

/**
 * Piezas comunes de las escrituras de jefatura sobre una NP: el rechazo con
 * mensaje, la lectura de una línea con su NP, su OT (si tiene) y la faena que
 * abastece el stock, y la comprobación de permiso y alcance.
 *
 * Una NP puede no tener OT (ADR 0001, 2026-11-27): entonces `workOrderId`, su folio y su
 * estado van en null, y la faena del stock es la de la propia NP (no hay equipo de la OT).
 */

type Reader = Pick<Tx, "select">

/** Un rechazo con mensaje para el usuario. Lanzarlo dentro de la transacción la revierte. */
export class NoteRefusal extends Error {
  constructor(message: string, readonly field?: string) {
    super(message)
    this.name = "NoteRefusal"
  }
}

/** Corre una operación y convierte sus rechazos en `{ ok: false }`; cualquier otro error sube. */
export async function guarded(operation: () => Promise<PartsActionResult>): Promise<PartsActionResult> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof NoteRefusal) return { ok: false, message: error.message, ...(error.field ? { field: error.field } : {}) }
    throw error
  }
}

/**
 * Toma las OT `FOR SHARE`, ordenadas por id: el primer paso de toda escritura sobre las líneas de una NP, como manda el
 * orden global de bloqueo (equipo → OT → faena → stock → reservas, ver `parts/allocations.ts`). Así una transición de
 * la OT (`FOR UPDATE`, que al cerrar o anular rechaza las líneas pendientes) espera AQUÍ y no se cruza con quien ya
 * tiene tomadas las filas de la NP y espera a la OT (el evento de la OT lleva una FK). Los nulos (NP sin OT) se ignoran.
 */
export async function lockWorkOrdersShare(tx: Tx, workOrderIds: ReadonlyArray<string | null | undefined>): Promise<void> {
  const ids = [...new Set(workOrderIds.filter((id): id is string => !!id))].sort()
  if (ids.length === 0) return
  await tx.select({ id: mantWorkOrders.id }).from(mantWorkOrders).where(inArray(mantWorkOrders.id, ids)).orderBy(asc(mantWorkOrders.id)).for("share")
}

const currentWorksite = alias(worksites, "np_current_worksite")

export interface NoteItemContext {
  itemId: string
  description: string
  quantity: number
  productId: string | null
  resolution: string
  noteId: string
  code: string
  noteStatus: string
  /** Faena de la NP (la de la OT, si la hay). */
  noteWorksiteId: string
  /** Null: nota sin OT. */
  workOrderId: string | null
  /** Null: nota sin OT. */
  workOrderFolio: string | null
  /** Null: nota sin OT. */
  workOrderStatus: string | null
  requestedByUserId: string | null
  /** Faena ACTUAL del equipo de la OT (`fuel_vehicles.worksite_id`). Null: nota sin equipo. */
  vehicleWorksiteId: string | null
  vehicleWorksiteName: string | null
  /** Faena cuyo stock abastece la línea: la del equipo de la OT hoy, o la de la propia NP si no hay equipo. */
  stockWorksiteId: string
  stockWorksiteName: string
}

/** Una línea con su NP. `lock` toma la fila de la línea (`FOR NO KEY UPDATE`: no choca con la FK de las reservas ni de las solicitudes). */
export async function loadItemContext(client: Reader, itemId: string, options: { lock?: boolean } = {}): Promise<NoteItemContext | null> {
  const noteWorksite = alias(worksites, "np_note_worksite")
  const query = client
    .select({
      itemId: mantPartsNoteItems.id,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      productId: mantPartsNoteItems.productId,
      resolution: mantPartsNoteItems.resolution,
      noteId: mantPartsNotes.id,
      code: mantPartsNotes.code,
      noteStatus: mantPartsNotes.status,
      noteWorksiteId: mantPartsNotes.worksiteId,
      noteWorksiteName: noteWorksite.name,
      workOrderId: mantPartsNotes.workOrderId,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      workOrderFolio: mantWorkOrders.folio,
      workOrderStatus: mantWorkOrders.status,
      vehicleWorksiteId: fuelVehicles.worksiteId,
      vehicleWorksiteName: currentWorksite.name,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .innerJoin(noteWorksite, eq(noteWorksite.id, mantPartsNotes.worksiteId))
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .leftJoin(currentWorksite, eq(currentWorksite.id, fuelVehicles.worksiteId))
    .where(eq(mantPartsNoteItems.id, itemId))
    .limit(1)
  const [row] = await (options.lock ? query.for("no key update", { of: mantPartsNoteItems }) : query)
  if (!row) return null
  return {
    ...row,
    quantity: Number(row.quantity),
    stockWorksiteId: row.vehicleWorksiteId ?? row.noteWorksiteId,
    stockWorksiteName: row.vehicleWorksiteName ?? row.noteWorksiteName,
  }
}

export interface NoteContext {
  noteId: string
  code: string
  status: string
  worksiteId: string
  /** Null: nota sin OT. */
  workOrderId: string | null
  workOrderFolio: string | null
  workOrderStatus: string | null
  requestedByUserId: string | null
  /** Faena actual del equipo de la OT (null: sin equipo). */
  vehicleWorksiteId: string | null
  stockWorksiteId: string
}

/** Una NP con su OT (si tiene) y la faena actual de su equipo. `lock` toma la fila de la NP. */
export async function loadNoteContext(client: Reader, noteId: string, options: { lock?: boolean } = {}): Promise<NoteContext | null> {
  const query = client
    .select({
      noteId: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      worksiteId: mantPartsNotes.worksiteId,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      workOrderStatus: mantWorkOrders.status,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantPartsNotes)
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
  const [row] = await (options.lock ? query.for("no key update", { of: mantPartsNotes }) : query)
  if (!row) return null
  return { ...row, stockWorksiteId: row.vehicleWorksiteId ?? row.worksiteId }
}

/** `mant:np:manage` y la faena de la NP (o la actual de su equipo) en el alcance; si no, rechaza con el motivo. */
export function assertCanManage(viewer: MantViewer, note: { noteWorksiteId: string; vehicleWorksiteId: string | null } | { worksiteId: string; vehicleWorksiteId: string | null }): void {
  const worksiteId = "noteWorksiteId" in note ? note.noteWorksiteId : note.worksiteId
  const check = canManageNote(viewer, { worksiteId, vehicleWorksiteId: note.vehicleWorksiteId })
  if (!check.ok) throw new NoteRefusal(check.message)
}

export const NOT_FOUND_ITEM = "Esa línea de la nota de pedido ya no existe."
export const NOT_FOUND_NOTE = "Esa nota de pedido ya no existe."

/** Motivo (≥ 5 letras) de un rechazo o una anulación. */
export function requireReason(reason: string, subject: string): string {
  const text = reason.trim()
  if (text.length < 5) throw new NoteRefusal(`Escribe el motivo ${subject} (al menos 5 letras).`, "reason")
  return text
}
