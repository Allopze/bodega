"use server"

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { z } from "zod"
import { db } from "@/db"
import { safeActionMessage } from "@/lib/action-error"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import { guardAnyPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { conciliatePart } from "@/lib/services/mantencion/parts/conciliation"
import { releaseAllocationTx } from "@/lib/services/mantencion/parts"
import { loadWorkOrderPartsOverview } from "@/lib/services/mantencion/parts-notes/query"
import { revalidateQueueOfNote } from "@/lib/services/mantencion/queue-revalidation"
import { rejectNoteItem, resolveNoteItemFromStock } from "@/lib/services/mantencion/parts-notes/resolve"
import { NoLinesToSendError, sendPartsNoteLinesToPurchase } from "@/lib/services/mantencion/parts-notes/send-to-purchase"
import { acceptPartsNote, holdPartsNote, rejectPartsNote, reopenPartsNote, voidPartsNote } from "@/lib/services/mantencion/parts-notes/transitions"
import type { ReturnedNoteLine } from "@/lib/services/mantencion/parts-notes/line-release"
import type { PartsActionResult } from "@/lib/services/mantencion/parts/types"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"
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
/** Reabrir tiene su propio permiso: quien resuelve notas no necesariamente puede reabrirlas. */
const REOPEN: Permission[] = ["mant:np:reopen"]

/** El mismo largo mínimo del motivo que exige `releaseAllocationTx` y que pide la pantalla. */
const REASON_MIN = 5
const id = z.string().trim().min(1).max(64).regex(/^[\w-]+$/, "Identificador inválido.")
const reason = z.string().trim().min(REASON_MIN, `Escribe un motivo de al menos ${REASON_MIN} caracteres.`).max(1000)
const quantity = z.number().positive("La cantidad debe ser mayor que cero.").max(100_000)

export interface NoteActionState {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string[]>
  /** Aceptar envía la nota a compra: la solicitud que salió, para que la pantalla enlace a ella. */
  data?: { requestId: string; requestCode: string; approved: boolean; needsQuotation: boolean }
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
const acceptSchema = z.object({ noteId: id })
const releaseSchema = z.object({ workOrderId: id, allocationId: id, quantity, reason })
const conciliateSchema = z.discriminatedUnion("mode", [
  z.object({ recordPartId: id, mode: z.literal("aplicar") }),
  z.object({ recordPartId: id, mode: z.literal("sin_movimiento"), reason }),
])

/**
 * Resolver, rechazar o anular cambia las líneas pendientes de la nota, que es lo que la cola de «Mis pendientes» y el aviso
 * del menú cuentan: se refrescan además de las pantallas de la nota.
 */
async function refreshNoteQueue(noteId: string) {
  refreshNotes(noteId)
  await revalidateQueueOfNote(noteId)
}

/** «Reservar de bodega»: reserva lo libre de la faena para la OT y deja la línea resuelta. */
export async function resolveNoteItemFromStockAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(resolveSchema, input)
  if (!parsed.ok) return parsed
  try {
    const { noteId, ...data } = parsed.data
    const result = await resolveNoteItemFromStock(viewerFromSession(guard.session), data)
    if (result.ok) await refreshNoteQueue(noteId)
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
    if (result.ok) await refreshNoteQueue(noteId)
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, "No se pudo rechazar la línea.")
  }
}

/**
 * Acciones de CABECERA de la nota (ADR 0001, 2026-11-27): aceptar, poner en espera, rechazar la nota entera, anular y reabrir.
 * Cada una revalida su permiso aquí y el servicio vuelve a validar estado, alcance de faena y motivo bajo bloqueo: las reglas
 * viven en el servidor (`transitions.ts`), la pantalla sólo muestra las que `allowedNoteActions` dice que valen.
 */
async function runHeaderAction(
  permissions: Permission[],
  schema: z.ZodType<{ noteId: string; reason?: string }>,
  input: unknown,
  run: (viewer: ReturnType<typeof viewerFromSession>, data: { noteId: string; reason?: string }) => Promise<PartsActionResult>,
  fallback: string,
): Promise<NoteActionState> {
  const guard = await guardAnyPermission(permissions, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(schema, input)
  if (!parsed.ok) return parsed
  try {
    const result = await run(viewerFromSession(guard.session), parsed.data)
    if (result.ok) await refreshNoteQueue(parsed.data.noteId)
    return toState(result)
  } catch (error) {
    return actionErrorResult(error, fallback)
  }
}

/**
 * Tras aceptar, sus líneas pendientes se envían a compra (D30): una solicitud por nota que cae en la cola de Compras, o queda
 * en borrador si la regla de cotización lo pide (D31). La aceptación ya está escrita: si el envío falla, queda aceptada y el
 * mensaje lo dice (`ok: false` para que se vea como aviso, no como éxito). Sin líneas pendientes no hay nada que enviar.
 */
async function sendAcceptedNoteToPurchase(session: Session, noteId: string, acceptedMessage: string | undefined): Promise<NoteActionState> {
  try {
    const sent = await sendPartsNoteLinesToPurchase(session, { noteId })
    revalidateOperationalViews(["/compras", "/compras/nueva", "/solicitudes", `/solicitudes/${sent.requestId}`])
    return {
      ok: true,
      message: `Aceptada. ${sent.message}`,
      data: { requestId: sent.requestId, requestCode: sent.requestCode, approved: sent.approved, needsQuotation: sent.needsQuotation },
    }
  } catch (error) {
    if (error instanceof NoLinesToSendError) return { ok: true, ...(acceptedMessage ? { message: acceptedMessage } : {}) }
    return { ok: false, message: `La nota quedó aceptada, pero no se pudo enviar a compra: ${safeActionMessage(error, "error inesperado")}` }
  }
}

/** «Aceptar y enviar a compra»: la nota queda aceptada (o vuelve al estado de sus líneas si estaba en espera) y sus líneas pendientes van a Compras. Sin motivo ni confirmación. */
export async function acceptPartsNoteAction(input: unknown): Promise<NoteActionState> {
  const guard = await guardAnyPermission(MANAGE, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ(acceptSchema, input)
  if (!parsed.ok) return parsed
  const { noteId } = parsed.data
  try {
    const accepted = await acceptPartsNote(viewerFromSession(guard.session), { noteId })
    if (!accepted.ok) return toState(accepted)
    const state = await sendAcceptedNoteToPurchase(guard.session, noteId, accepted.message)
    await refreshNoteQueue(noteId)
    return state
  } catch (error) {
    return actionErrorResult(error, "No se pudo aceptar la nota.")
  }
}

/** «Poner en espera»: congela la nota hasta que se acepte; el motivo queda en el historial y se muestra. */
export async function holdPartsNoteAction(input: unknown): Promise<NoteActionState> {
  return runHeaderAction(MANAGE, voidSchema, input, holdPartsNote, "No se pudo poner la nota en espera.")
}

/** «Rechazar nota»: rechaza todas las líneas pendientes con el mismo motivo. */
export async function rejectPartsNoteAction(input: unknown): Promise<NoteActionState> {
  return runHeaderAction(MANAGE, voidSchema, input, rejectPartsNote, "No se pudo rechazar la nota.")
}

/** «Reabrir»: las líneas rechazadas vuelven a pendiente. Pide `mant:np:reopen`, no `manage`. */
export async function reopenPartsNoteAction(input: unknown): Promise<NoteActionState> {
  return runHeaderAction(REOPEN, voidSchema, input, reopenPartsNote, "No se pudo reabrir la nota.")
}

/** «Anular nota»: queda visible y marcada, con su motivo. */
export async function voidPartsNoteAction(input: unknown): Promise<NoteActionState> {
  return runHeaderAction(MANAGE, voidSchema, input, voidPartsNote, "No se pudo anular la nota.")
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
