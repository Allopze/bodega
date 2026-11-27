import { asc, eq, inArray } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelVehicles, mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { safeActionMessage } from "@/lib/action-error"
import { formatQty } from "@/lib/utils"
import { viewerFromSession, type MantViewer } from "../access"
import { canManageNote, NP_PERMISSIONS } from "./access"
import { NoteRefusal, requireReason } from "./context"
import { rejectNoteItem, resolveNoteItemFromStock } from "./resolve"
import { sendPartsNoteLinesToPurchase } from "./send-to-purchase"

/**
 * Decisiones por línea en lote desde la bandeja (ADR 0001, D33): «Enviar a compra», «Sacar de bodega» y «Rechazar» sobre
 * las líneas pendientes de varias notas a la vez. Se agrupa por nota y cada nota va por su cuenta (sus propias
 * transacciones): una que falla no tumba a las demás, y el resultado dice cuántas líneas salieron y por qué fallaron las
 * otras notas. Exige `mant:np:manage`; el alcance de faena lo vuelve a mirar cada servicio, nota por nota.
 *
 * Una nota que falla a medias (sacar de bodega línea a línea) deja lo que ya hizo: `ok` cuenta esas líneas y el fallo
 * dice cuál no pudo y por qué.
 */

export type BulkLineDecision = "comprar" | "bodega" | "rechazar"

export interface BulkLinesResult {
  /** Líneas que salieron bien (enviadas a compra, sacadas de bodega o rechazadas). */
  ok: number
  /** Una entrada por nota que no pudo, con el motivo. */
  failed: Array<{ noteCode: string; message: string }>
  /** Una solicitud por nota enviada a compra; `approved: false` quedó enviada y espera su aprobación en Aprobaciones. */
  requests: Array<{ code: string; id: string; approved: boolean }>
}

interface LineRow {
  id: string
  description: string
  quantity: number
  productId: string | null
  noteId: string
  noteCode: string
  workOrderId: string | null
}

/**
 * Las líneas elegidas con su nota. Una línea de una nota que no es del alcance de quien actúa (ni por su faena ni por la actual de su
 * equipo) se trata como una línea que no existe: no se delata ni su nota ni su código.
 */
async function loadLines(viewer: MantViewer, lineIds: readonly string[]): Promise<LineRow[]> {
  const rows = await db
    .select({
      id: mantPartsNoteItems.id,
      description: mantPartsNoteItems.description,
      quantity: mantPartsNoteItems.quantity,
      productId: mantPartsNoteItems.productId,
      noteId: mantPartsNotes.id,
      noteCode: mantPartsNotes.code,
      workOrderId: mantPartsNotes.workOrderId,
      sortOrder: mantPartsNoteItems.sortOrder,
      worksiteId: mantPartsNotes.worksiteId,
      vehicleWorksiteId: fuelVehicles.worksiteId,
    })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantPartsNotes.vehicleId))
    .where(inArray(mantPartsNoteItems.id, [...lineIds]))
    .orderBy(asc(mantPartsNotes.code), asc(mantPartsNoteItems.sortOrder))
  return rows
    .filter((row) => canManageNote(viewer, { worksiteId: row.worksiteId, vehicleWorksiteId: row.vehicleWorksiteId ?? null }).ok)
    .map((row): LineRow => ({
      id: row.id, description: row.description, quantity: Number(row.quantity), productId: row.productId,
      noteId: row.noteId, noteCode: row.noteCode, workOrderId: row.workOrderId,
    }))
}

/** El mensaje que ve quien actúa: los rechazos de negocio tal cual; cualquier otro error, sin detalles del motor. */
const messageOf = (error: unknown) => (error instanceof NoteRefusal ? error.message : safeActionMessage(error, "No se pudo completar la operación."))

/** Sacar de bodega apartea stock para la OT: sin OT o sin repuesto de catálogo no hay qué apartar. Dice el motivo, o `null` si todas sirven. */
function whyNotFromStock(lines: readonly LineRow[]): string | null {
  const [first] = lines
  if (!first?.workOrderId) return "Una nota sin OT no aparta stock: el repuesto ya está libre en la bodega de la faena. Envíala a compra o recházala."
  const free = lines.find((line) => !line.productId)
  return free ? `«${free.description}» no tiene un repuesto de catálogo: elígelo en el detalle de la nota para sacarlo de bodega.` : null
}

export async function decidePartsNoteLinesInBulk(
  session: Session,
  input: { lineIds: string[]; decision: BulkLineDecision; reason?: string },
): Promise<BulkLinesResult> {
  const viewer: MantViewer = viewerFromSession(session)
  if (!viewer.permissions.includes(NP_PERMISSIONS.manage)) throw new NoteRefusal("No tienes permiso para resolver notas de pedido.")
  const lineIds = [...new Set(input.lineIds)]
  if (lineIds.length === 0) throw new NoteRefusal("Elige al menos una línea.")
  // El motivo se exige antes de tocar nada: ninguna nota se rechaza a medias por falta de él.
  const reason = input.decision === "rechazar" ? requireReason(input.reason ?? "", "del rechazo") : null

  const rows = await loadLines(viewer, lineIds)
  const result: BulkLinesResult = { ok: 0, failed: [], requests: [] }
  if (rows.length < lineIds.length) result.failed.push({ noteCode: "—", message: "Alguna de las líneas elegidas ya no existe." })

  const byNote = new Map<string, LineRow[]>()
  for (const row of rows) byNote.set(row.noteId, [...(byNote.get(row.noteId) ?? []), row])

  for (const [noteId, lines] of byNote) {
    const noteCode = lines[0]!.noteCode
    try {
      if (input.decision === "comprar") {
        const sent = await sendPartsNoteLinesToPurchase(session, { noteId, lineIds: lines.map((line) => line.id), origin: "lineas" })
        result.ok += sent.lineCount
        // `approved: false` no es un fallo: la solicitud existe y espera su aprobación en Aprobaciones (lo dice el aviso de la acción).
        result.requests.push({ code: sent.requestCode, id: sent.requestId, approved: sent.approved })
      } else if (input.decision === "bodega") {
        const blocked = whyNotFromStock(lines)
        if (blocked) throw new NoteRefusal(blocked)
        for (const line of lines) {
          const done = await resolveNoteItemFromStock(viewer, { itemId: line.id, productId: line.productId!, quantity: line.quantity })
          if (!done.ok) throw new NoteRefusal(`«${line.description}» (${formatQty(line.quantity)}): ${done.message}`)
          result.ok += 1
        }
      } else {
        for (const line of lines) {
          const done = await rejectNoteItem(viewer, { itemId: line.id, reason: reason! })
          if (!done.ok) throw new NoteRefusal(`«${line.description}»: ${done.message}`)
          result.ok += 1
        }
      }
    } catch (error) {
      result.failed.push({ noteCode, message: messageOf(error) })
    }
  }
  return result
}
