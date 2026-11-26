import { eq } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Tx } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes, mantWorkOrders, worksites } from "@/db/schema"
import type { MantViewer } from "../access"
import type { PartsActionResult } from "../parts/types"
import { canManageNote } from "./access"

/**
 * Piezas comunes de las escrituras de jefatura sobre una NP: el rechazo con
 * mensaje, la lectura de una línea con su NP, su OT y la faena ACTUAL del equipo
 * (la del stock), y la comprobación de permiso y alcance.
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
  noteWorksiteId: string
  workOrderId: string
  requestedByUserId: string
  workOrderFolio: string
  workOrderStatus: string
  /** Faena ACTUAL del equipo (`fuel_vehicles.worksite_id`): de ahí sale el stock. */
  vehicleWorksiteId: string
  vehicleWorksiteName: string
}

/** Una línea con su NP. `lock` toma la fila de la línea (`FOR NO KEY UPDATE`: no choca con la FK de las reservas ni de las solicitudes). */
export async function loadItemContext(client: Reader, itemId: string, options: { lock?: boolean } = {}): Promise<NoteItemContext | null> {
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
      workOrderId: mantPartsNotes.workOrderId,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      workOrderFolio: mantWorkOrders.folio,
      workOrderStatus: mantWorkOrders.status,
      vehicleWorksiteId: fuelVehicles.worksiteId,
      vehicleWorksiteName: currentWorksite.name,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .innerJoin(currentWorksite, eq(currentWorksite.id, fuelVehicles.worksiteId))
    .where(eq(mantPartsNoteItems.id, itemId))
    .limit(1)
  const [row] = await (options.lock ? query.for("no key update", { of: mantPartsNoteItems }) : query)
  return row ? { ...row, quantity: Number(row.quantity) } : null
}

export interface NoteContext {
  noteId: string
  code: string
  status: string
  worksiteId: string
  workOrderId: string
  workOrderFolio: string
  requestedByUserId: string
  vehicleWorksiteId: string
}

/** Una NP con su OT y la faena actual de su equipo. `lock` toma la fila de la NP. */
export async function loadNoteContext(client: Reader, noteId: string, options: { lock?: boolean } = {}): Promise<NoteContext | null> {
  const query = client
    .select({
      noteId: mantPartsNotes.id,
      code: mantPartsNotes.code,
      status: mantPartsNotes.status,
      worksiteId: mantPartsNotes.worksiteId,
      workOrderId: mantPartsNotes.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      requestedByUserId: mantPartsNotes.requestedByUserId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantPartsNotes)
    .innerJoin(mantWorkOrders, eq(mantWorkOrders.id, mantPartsNotes.workOrderId))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
  const [row] = await (options.lock ? query.for("no key update", { of: mantPartsNotes }) : query)
  return row ?? null
}

/** `mant:np:manage` y la faena de la NP (o la actual de su equipo) en el alcance; si no, rechaza con el motivo. */
export function assertCanManage(viewer: MantViewer, note: { noteWorksiteId: string; vehicleWorksiteId: string } | { worksiteId: string; vehicleWorksiteId: string }): void {
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

