import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantPartsNoteItems } from "@/db/schema"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { inWorksiteScope, NP_PERMISSIONS } from "./access"
import type { MantViewer } from "../access"
import type { PartsActionResult, PartsNoteStatus } from "../parts/types"
import { guarded, loadNoteContext, lockWorkOrdersShare, NoteRefusal, NOT_FOUND_NOTE, requireReason, type NoteContext } from "./context"
import { loadPurchases } from "./lines"
import { setNoteStatusTx } from "./set-status"
import { allPurchasesDead, deriveNoteStatusTx, recalcNoteStatusTx } from "./status"
import { writeTrail } from "./trail"

/** El único camino que escribe el estado de la nota (con su evento): se reexporta aquí, donde vive el contrato de transiciones. */
export { setNoteStatusTx, type SetNoteStatusOptions, type SetNoteStatusResult } from "./set-status"

/**
 * Transiciones de CABECERA de una nota de pedido (NP), ADR 0001 y 2026-11-27: aceptar, poner en espera, rechazar la nota
 * entera, anular y reabrir. Toda escritura pasa por `setNoteStatusTx`, que deja el evento en la misma transacción.
 *
 * Orden de bloqueo: OT `FOR SHARE` (si la NP tiene OT) → líneas `FOR NO KEY UPDATE` por id → fila de la NP. Así una
 * transición que toca líneas no se cruza con quien ya tiene la NP y espera una línea.
 *
 * Quién: aceptar, en espera, rechazar y anular exigen `mant:np:manage` y la faena de la NP (o la actual de su equipo)
 * en el alcance de quien actúa. Reabrir exige `mant:np:reopen` y ese mismo alcance: ocultar el botón no es control.
 */

/** Acciones de cabecera. `to: 'derivado'`: el estado sale de las líneas (no lo elige quien actúa). */
export const NOTE_ACTION_KEYS = ["aceptar", "en_espera", "rechazar", "anular", "reabrir"] as const
export type NoteActionKey = (typeof NOTE_ACTION_KEYS)[number]

export interface NoteActionSpec {
  key: NoteActionKey
  label: string
  /** Infinitivo para el mensaje de rechazo: «no se puede anular». */
  verb: string
  /** Estados desde los que se puede. */
  from: readonly PartsNoteStatus[]
  /** Hacia dónde: un estado fijo, o `derivado` (lo fijan las líneas). Aceptar desde la espera también deriva si ya hay líneas resueltas. */
  to: PartsNoteStatus | "derivado"
  /** Exige motivo de al menos 5 letras. */
  reason: boolean
  /** Permiso: `manage` (con alcance de faena) o `reopen`. */
  permission: "manage" | "reopen"
}

export const NOTE_ACTIONS: Readonly<Record<NoteActionKey, NoteActionSpec>> = {
  aceptar: { key: "aceptar", label: "Aceptar", verb: "aceptar", from: ["enviada", "en_espera"], to: "aceptada", reason: false, permission: "manage" },
  en_espera: { key: "en_espera", label: "Poner en espera", verb: "poner en espera", from: ["enviada", "aceptada"], to: "en_espera", reason: true, permission: "manage" },
  rechazar: { key: "rechazar", label: "Rechazar nota", verb: "rechazar", from: ["enviada", "aceptada", "en_espera", "en_gestion"], to: "derivado", reason: true, permission: "manage" },
  anular: {
    key: "anular", label: "Anular nota", verb: "anular",
    from: ["enviada", "aceptada", "en_espera", "en_gestion", "en_compra", "recibida_parcial"],
    to: "anulada", reason: true, permission: "manage",
  },
  reabrir: { key: "reabrir", label: "Reabrir", verb: "reabrir", from: ["rechazada", "cerrada"], to: "derivado", reason: true, permission: "reopen" },
}

export interface NoteActionPermissions {
  manage: boolean
  reopen: boolean
}

export interface NoteActionFacts {
  /** Líneas rechazadas: sólo se reabren las que hay. */
  rejectedLines: number
  /** La OT de la NP sigue abierta. Sin OT, `true`. */
  workOrderOpen: boolean
}

/**
 * Qué acciones de cabecera son válidas para una NP en `status`, con esos permisos y esos hechos. Función pura: la usa la
 * UI para mostrar sólo lo válido, y el servidor repite la misma regla dentro de la transacción.
 */
export function allowedNoteActions(status: PartsNoteStatus, perms: NoteActionPermissions, facts: NoteActionFacts): NoteActionKey[] {
  return NOTE_ACTION_KEYS.filter((key) => {
    const spec = NOTE_ACTIONS[key]
    if (!spec.from.includes(status)) return false
    if (spec.permission === "manage" ? !perms.manage : !perms.reopen) return false
    if (key === "reabrir") return facts.rejectedLines > 0 && facts.workOrderOpen
    return true
  })
}

const STATUS_LABEL: Record<PartsNoteStatus, string> = {
  enviada: "enviada",
  aceptada: "aceptada",
  en_espera: "en espera",
  en_gestion: "en gestión",
  en_compra: "en compra",
  recibida_parcial: "recibida parcial",
  cerrada: "cerrada",
  rechazada: "rechazada",
  anulada: "anulada",
}

const REASON_SUBJECT: Record<NoteActionKey, string> = {
  aceptar: "",
  en_espera: "de la espera",
  rechazar: "del rechazo",
  anular: "de la anulación",
  reabrir: "de la reapertura",
}

/** Lo que el servidor contesta cuando la acción no vale para el estado actual. */
function refuseAction(key: NoteActionKey, note: NoteContext, rejectedLines: number): never {
  const status = note.status as PartsNoteStatus
  if (key === "reabrir") {
    if (status === "cerrada" && rejectedLines === 0) throw new NoteRefusal("Todo lo pedido ya llegó a la faena: pide con una nota nueva.")
    if (!workOrderOpenOf(note)) throw new NoteRefusal(`La orden ${note.workOrderFolio} ya terminó: pide con una nota nueva.`)
  }
  if (status === "anulada") throw new NoteRefusal(`La nota ${note.code} ya está anulada.`)
  if (key === "en_espera" && status === "en_espera") throw new NoteRefusal(`La nota ${note.code} ya está en espera.`)
  throw new NoteRefusal(`La nota ${note.code} está ${STATUS_LABEL[status] ?? status}: no se puede ${NOTE_ACTIONS[key].verb}.`)
}

/** Permiso y alcance de la acción, antes de abrir la transacción (se vuelven a mirar con la NP bloqueada). */
function assertActionAllowed(viewer: MantViewer, key: NoteActionKey, note: { worksiteId: string; vehicleWorksiteId: string | null }): void {
  const spec = NOTE_ACTIONS[key]
  if (spec.permission === "manage" && !viewer.permissions.includes(NP_PERMISSIONS.manage)) {
    throw new NoteRefusal("No tienes permiso para resolver notas de pedido.")
  }
  if (spec.permission === "reopen" && !viewer.permissions.includes(NP_PERMISSIONS.reopen)) {
    throw new NoteRefusal("No tienes permiso para reabrir notas de pedido.")
  }
  const inScope = inWorksiteScope(viewer, note.worksiteId) || (!!note.vehicleWorksiteId && inWorksiteScope(viewer, note.vehicleWorksiteId))
  if (!inScope) throw new NoteRefusal("Esta nota de pedido es de una faena que no es de tu alcance.")
}

/**
 * Ejecuta una acción de cabecera: permiso y alcance, OT → líneas → NP bloqueadas, validación con la NP bloqueada, cambio
 * de estado con `setNoteStatusTx` y rastro (evento de la OT si la hay, y auditoría de la NP).
 */
async function runNoteAction(viewer: MantViewer, key: NoteActionKey, input: { noteId: string; reason?: string }): Promise<PartsActionResult> {
  return guarded(async () => {
    const spec = NOTE_ACTIONS[key]
    const reason = spec.reason ? requireReason(input.reason ?? "", REASON_SUBJECT[key]) : (input.reason?.trim() || null)
    const first = await loadNoteContext(db, input.noteId)
    if (!first) throw new NoteRefusal(NOT_FOUND_NOTE)
    assertActionAllowed(viewer, key, { worksiteId: first.worksiteId, vehicleWorksiteId: first.vehicleWorksiteId })

    return db.transaction(async (tx): Promise<PartsActionResult> => {
      await lockWorkOrdersShare(tx, [first.workOrderId])
      const items = await tx
        .select({ id: mantPartsNoteItems.id, description: mantPartsNoteItems.description, resolution: mantPartsNoteItems.resolution, sortOrder: mantPartsNoteItems.sortOrder })
        .from(mantPartsNoteItems)
        .where(eq(mantPartsNoteItems.noteId, input.noteId))
        .orderBy(asc(mantPartsNoteItems.id))
        .for("no key update")
      const note = await loadNoteContext(tx, input.noteId, { lock: true })
      if (!note) throw new NoteRefusal(NOT_FOUND_NOTE)
      assertActionAllowed(viewer, key, { worksiteId: note.worksiteId, vehicleWorksiteId: note.vehicleWorksiteId })
      const rejectedIds = items.filter((item) => item.resolution === "rechazada").map((item) => item.id)
      // Anular: lo que lo impide en las líneas (un repuesto apartado, una compra en curso) se dice antes que el estado de la nota,
      // que con esas líneas suele ser «cerrada» o «en compra».
      if (key === "anular" && note.status !== "anulada") await assertNoteCanBeVoided(tx, items, note.code)
      const facts: NoteActionFacts = { rejectedLines: rejectedIds.length, workOrderOpen: workOrderOpenOf(note) }
      const perms: NoteActionPermissions = { manage: viewer.permissions.includes(NP_PERMISSIONS.manage), reopen: viewer.permissions.includes(NP_PERMISSIONS.reopen) }
      if (!allowedNoteActions(note.status as PartsNoteStatus, perms, facts).includes(key)) refuseAction(key, note, facts.rejectedLines)

      const actor = { userId: viewer.userId, email: viewer.email }
      const from = note.status as PartsNoteStatus
      const trail = (changeSet: Record<string, unknown>, to: PartsNoteStatus, action: "status_change" | "cancel" = "status_change") => writeTrail(tx, {
        workOrderId: note.workOrderId, worksiteId: note.worksiteId, noteId: note.noteId, code: note.code,
        actor, action, reason,
        oldState: { status: from },
        changeSet: { status: to, ...changeSet },
      })

      switch (key) {
        case "aceptar": {
          // Aceptar desde la espera vuelve al estado que corresponde a las líneas (aceptada si nada se resolvió todavía).
          const next = await deriveNoteStatusTx(tx, note.noteId, { accepted: true })
          await setNoteStatusTx(tx, note.noteId, next, { actorUserId: viewer.userId })
          await trail({ accepted: true }, next)
          return { ok: true, message: `La nota ${note.code} quedó ${STATUS_LABEL[next]}.` }
        }
        case "en_espera": {
          await setNoteStatusTx(tx, note.noteId, "en_espera", { actorUserId: viewer.userId, reason })
          await trail({}, "en_espera")
          return { ok: true, message: `La nota ${note.code} quedó en espera: las líneas no se resuelven hasta que la aceptes.` }
        }
        case "rechazar": {
          // Rechaza TODAS las pendientes en una sola escritura y recalcula UNA vez, forzado: la espera no lo impide.
          const pendingIds = items.filter((item) => item.resolution === "pendiente").map((item) => item.id)
          if (pendingIds.length > 0) {
            await tx.update(mantPartsNoteItems).set({
              resolution: "rechazada", resolutionReason: reason, resolvedByUserId: viewer.userId, resolvedAt: new Date().toISOString(),
            }).where(and(inArray(mantPartsNoteItems.id, pendingIds), eq(mantPartsNoteItems.resolution, "pendiente")))
          }
          const next = await recalcNoteStatusTx(tx, note.noteId, { force: true, actorUserId: viewer.userId, reason })
          await trail({ rejectedItems: pendingIds, count: pendingIds.length }, next)
          const lines = pendingIds.length === 1 ? "1 línea pendiente" : `${pendingIds.length} líneas pendientes`
          return { ok: true, message: `Se rechazaron ${lines} de la nota ${note.code}. La nota quedó ${STATUS_LABEL[next as PartsNoteStatus]}.` }
        }
        case "anular": {
          await setNoteStatusTx(tx, note.noteId, "anulada", { actorUserId: viewer.userId, reason })
          await trail({ reason }, "anulada", "cancel")
          return { ok: true, message: `La nota ${note.code} quedó anulada.` }
        }
        case "reabrir": {
          // Las rechazadas vuelven a pendiente (sin quien las resolvió); el estado sale de lo que quede.
          await tx.update(mantPartsNoteItems).set({
            resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null,
          }).where(and(inArray(mantPartsNoteItems.id, rejectedIds), eq(mantPartsNoteItems.resolution, "rechazada")))
          const next = await recalcNoteStatusTx(tx, note.noteId, { force: true, actorUserId: viewer.userId, reason })
          await trail({ reopenedItems: rejectedIds, count: rejectedIds.length }, next)
          const lines = rejectedIds.length === 1 ? "1 línea vuelve" : `${rejectedIds.length} líneas vuelven`
          return { ok: true, message: `La nota ${note.code} se reabrió: ${lines} a pendiente.` }
        }
      }
    })
  })
}

/** La OT de la NP sigue abierta (sin OT, `true`: nada la cierra). */
function workOrderOpenOf(note: Pick<NoteContext, "workOrderId" | "workOrderStatus">): boolean {
  return !note.workOrderId || (!!note.workOrderStatus && (OT_OPEN_STATUSES as readonly string[]).includes(note.workOrderStatus))
}

/**
 * Anular sólo si ninguna línea se apartó del stock (eso se libera antes) ni tiene una compra en curso (esa solicitud se anula
 * antes). Con la NP bloqueada.
 */
async function assertNoteCanBeVoided(tx: Tx, items: ReadonlyArray<{ id: string; description: string; resolution: string }>, code: string): Promise<void> {
  const purchases = await loadPurchases(tx, items.map((item) => item.id))
  for (const item of items) {
    if (item.resolution === "desde_stock") {
      throw new NoteRefusal(`«${item.description}» ya se apartó del stock de la faena: libera esa reserva antes de anular la nota.`)
    }
    const liveness = (purchases.get(item.id) ?? []).map((row) => ({ itemStatus: row.status, requestStatus: row.requestStatus }))
    if (item.resolution === "en_compra" && !allPurchasesDead(liveness)) {
      throw new NoteRefusal(`«${item.description}» tiene una compra en curso: anula esa solicitud antes de anular la nota ${code}.`)
    }
  }
}

export function acceptPartsNote(viewer: MantViewer, input: { noteId: string; reason?: string }): Promise<PartsActionResult> {
  return runNoteAction(viewer, "aceptar", input)
}

export function holdPartsNote(viewer: MantViewer, input: { noteId: string; reason?: string }): Promise<PartsActionResult> {
  return runNoteAction(viewer, "en_espera", input)
}

export function rejectPartsNote(viewer: MantViewer, input: { noteId: string; reason?: string }): Promise<PartsActionResult> {
  return runNoteAction(viewer, "rechazar", input)
}

export function reopenPartsNote(viewer: MantViewer, input: { noteId: string; reason?: string }): Promise<PartsActionResult> {
  return runNoteAction(viewer, "reabrir", input)
}

/** Anula la nota (motivo obligatorio). Ver `assertNoteCanBeVoided` para lo que lo impide. */
export function voidPartsNote(viewer: MantViewer, input: { noteId: string; reason?: string }): Promise<PartsActionResult> {
  return runNoteAction(viewer, "anular", input)
}
