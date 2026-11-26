"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { db } from "@/db"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import { guardAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { conciliatePart } from "@/lib/services/mantencion/parts/conciliation"
import { releaseAllocationTx } from "@/lib/services/mantencion/parts"
import { loadWorkOrderPartsOverview } from "@/lib/services/mantencion/parts-notes/query"
import { rejectNoteItem, resolveNoteItemFromStock, voidPartsNote } from "@/lib/services/mantencion/parts-notes/resolve"
import type { ReturnedNoteLine } from "@/lib/services/mantencion/parts-notes/line-release"
import type { PartsActionResult } from "@/lib/services/mantencion/parts/types"
import { formatQty } from "@/lib/utils"
import type { Permission } from "@/modules/permissions"

/**
 * Acciones de la bandeja y del detalle de notas de pedido (ADR mantención 0001). Cada una revalida el permiso
 * grueso (`mant:np:manage`) en el servidor, valida la entrada con Zod y delega en el servicio, que comprueba el
 * alcance de faena y el estado bajo bloqueo; después refresca las pantallas que muestran la nota. Ocultar un botón
 * no es autorización: esto es lo que decide.
 */

const PATH = "/mantencion/notas-pedido"
const MANAGE: Permission[] = ["mant:np:manage"]

/** El mismo largo mínimo del motivo que exige `releaseAllocationTx` y que pide la pantalla. */
const REASON_MIN = 5
const id = z.string().trim().min(1).max(64).regex(/^[\w-]+$/, "Identificador inválido.")
const reason = z.string().trim().min(REASON_MIN, `Escribe un motivo de al menos ${REASON_MIN} caracteres.`).max(1000)
const quantity = z.number().positive("La cantidad debe ser mayor que cero.").max(100_000)

export interface NoteActionState {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
}

function toState(result: PartsActionResult): NoteActionState {
  if (result.ok) return { ok: true, ...(result.message ? { message: result.message } : {}) }
  return { ok: false, message: result.message, ...(result.field ? { fieldErrors: { [result.field]: [result.message] } } : {}) }
}

/** Refresca la bandeja, el detalle de la nota, las OT (su sección «Repuestos» y el aviso al cerrar) y el Panel. */
function refreshNotes(noteId?: string) {
  revalidatePath(PATH)
  if (noteId) revalidatePath(`${PATH}/${noteId}`)
  revalidatePath("/mantencion/ot/[id]", "page")
  revalidatePath("/mantencion/panel")
}

const resolveSchema = z.object({ noteId: id, itemId: id, productId: id, quantity })
const rejectSchema = z.object({ noteId: id, itemId: id, reason })
const voidSchema = z.object({ noteId: id, reason })
const releaseSchema = z.object({ workOrderId: id, allocationId: id, quantity, reason })
const conciliateSchema = z.discriminatedUnion("mode", [
  z.object({ recordPartId: id, mode: z.literal("aplicar") }),
  z.object({ recordPartId: id, mode: z.literal("sin_movimiento"), reason }),
])

/** «Reservar de bodega»: reserva lo libre de la faena para la OT y deja la línea resuelta. */
export async function resolveNoteItemFromStockAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(resolveSchema, input)
  if (!parsed.ok) return parsed
  try {
    const { noteId, ...data } = parsed.data
    const result = await resolveNoteItemFromStock(viewerFromSession(guard.session), data)
    if (result.ok) refreshNotes(noteId)
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, "No se pudo reservar el repuesto de la bodega.")
  }
}

/** «Rechazar»: la línea no se compra ni se reserva; el motivo lo lee el mecánico. */
export async function rejectNoteItemAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(rejectSchema, input)
  if (!parsed.ok) return parsed
  try {
    const { noteId, ...data } = parsed.data
    const result = await rejectNoteItem(viewerFromSession(guard.session), data)
    if (result.ok) refreshNotes(noteId)
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, "No se pudo rechazar la línea.")
  }
}

/** «Anular nota»: queda visible y marcada, con su motivo. */
export async function voidPartsNoteAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(voidSchema, input)
  if (!parsed.ok) return parsed
  try {
    const result = await voidPartsNote(viewerFromSession(guard.session), parsed.data)
    if (result.ok) refreshNotes(parsed.data.noteId)
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, "No se pudo anular la nota.")
  }
}

/** Lo que le pasó a las líneas de nota que esa reserva alimentaba, dicho al final del aviso de «Liberar». */
function returnedLinesText(lines: readonly ReturnedNoteLine[]): string {
  const back = lines.filter((line) => line.outcome === "pendiente")
  const rejected = lines.length - back.length
  const parts: string[] = []
  if (back.length === 1) parts.push(`«${back[0]!.description}» de ${back[0]!.noteCode} volvió a pendiente.`)
  else if (back.length > 1) parts.push(`${back.length} líneas de notas de pedido volvieron a pendiente.`)
  if (rejected > 0) parts.push(rejected === 1 ? "Una línea se rechazó sola porque la orden ya terminó." : `${rejected} líneas se rechazaron solas porque la orden ya terminó.`)
  return parts.length > 0 ? ` ${parts.join(" ")}` : ""
}

/**
 * «Liberar» una reserva sin usar de la OT (pasa a stock libre de su faena). `releaseAllocationTx` no mira el
 * alcance: la reserva se busca entre las que la OT tiene según el servicio de lectura (que sí lo aplica) y, además,
 * debe estar en una faena de quien actúa. Las líneas de nota «desde stock» que esa reserva alimentaba vuelven a
 * pendiente (NP4-4 y NP4-6) y el aviso lo dice.
 */
export async function releaseAllocationAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(releaseSchema, input)
  if (!parsed.ok) return parsed
  const viewer = viewerFromSession(guard.session)
  try {
    const { workOrderId, allocationId, quantity: amount, reason: text } = parsed.data
    const overview = await loadWorkOrderPartsOverview(viewer, workOrderId)
    const allocation = overview.available.find((item) => item.allocationId === allocationId)
    if (!allocation) return { ok: false, message: "Esa reserva ya no está disponible." }
    if (!viewer.isGlobal && !viewer.worksiteIds.includes(allocation.worksiteId)) {
      return { ok: false, message: "No tienes permisos para realizar esta acción" }
    }
    const released = await db.transaction((tx) => releaseAllocationTx(tx, {
      allocationId, quantity: amount, reason: text, actorUserId: viewer.userId, ...(viewer.email ? { userEmail: viewer.email } : {}),
    }))
    const returned = released.returnedLines ?? []
    refreshNotes()
    for (const noteId of new Set(returned.map((line) => line.noteId))) revalidatePath(`${PATH}/${noteId}`)
    return { ok: true, message: `Liberaste ${formatQty(released.released)} de «${allocation.name}»; pasa a stock libre de ${allocation.worksiteName}.${returnedLinesText(returned)}` }
  } catch (error) {
    return actionErrorResult(error, "No se pudo liberar el repuesto.")
  }
}

/**
 * Conciliar un repuesto que el mecánico declaró usar sin que hubiera stock: «Descontar ahora» (`aplicar`) o
 * «No salió de bodega» (`sin_movimiento`, con motivo). El servicio aplica el orden de bloqueo y el alcance.
 */
export async function conciliatePartAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(conciliateSchema, input)
  if (!parsed.ok) return parsed
  try {
    const result = await conciliatePart(viewerFromSession(guard.session), parsed.data)
    if (result.ok) {
      refreshNotes()
      revalidatePath("/mantencion/registros")
      revalidatePath("/bodega")
    }
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, "No se pudo conciliar el repuesto.")
  }
}
