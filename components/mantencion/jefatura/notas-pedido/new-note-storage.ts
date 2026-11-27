import type { NewNoteOptions } from "@/lib/services/mantencion/parts-notes/new-note-options"
import {
  chargeBelongsTo, defaultCharge, NEW_NOTE_DEFAULT_UNIT, NEW_NOTE_DESCRIPTION_MAX, NEW_NOTE_MAX_LINES, NEW_NOTE_NOTES_MAX, newLine,
  type DraftLine, type NoteDraft, type NoteLinePart,
} from "./new-note-draft"

/**
 * Borrador de «Nueva nota de pedido» en `localStorage`: la nota se escribe en terreno, donde la señal falla, y un envío caído
 * o una pestaña cerrada no pueden costar lo escrito. Se guarda en cada cambio, se restaura al volver y se borra al crearse
 * la nota. La `clientOpId` viaja con el borrador: reabrirlo y reenviar es el mismo envío y el servidor no duplica.
 *
 * - Una clave por persona (`…:<userId>`): un equipo compartido no hereda el borrador de otro. Al cerrar sesión no se borra
 *   (ese limpiador no conoce esta clave): por eso además se verifica la persona dentro del contenido.
 * - Todo acceso va envuelto en try/catch: en modo privado o con el almacenamiento bloqueado el propio accessor lanza.
 *   Un borrador que no se puede leer es «no había borrador»; uno que no se puede escribir se avisa (`writeDraft` → `false`).
 * - Lo guardado no es de fiar (otra versión, otra faena, un cargo que ya no existe): `sanitizeDraft` suelta lo que no calce
 *   con lo que hoy se ofrece y el servidor valida igual al enviar.
 */

const KEY_PREFIX = "chome:np-nueva-borrador:"
const SCHEMA = 1
/** Un borrador de hace más de un mes ya no es lo que la persona quería pedir. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface StoredDraft {
  draft: NoteDraft
  /** ISO de la última vez que se guardó. */
  savedAt: string
}

export const draftStorageKey = (userId: string) => `${KEY_PREFIX}${userId}`

export function writeDraft(userId: string, draft: NoteDraft, now: Date = new Date()): boolean {
  try {
    localStorage.setItem(draftStorageKey(userId), JSON.stringify({ schema: SCHEMA, userId, savedAt: now.toISOString(), draft }))
    return true
  } catch {
    return false
  }
}

export function clearDraft(userId: string): void {
  try {
    localStorage.removeItem(draftStorageKey(userId))
  } catch {
    /* almacenamiento bloqueado: no es requisito */
  }
}

/** El borrador guardado de esta persona, ya ajustado a lo que hoy se ofrece; `null` si no hay, está vencido o es ilegible. */
export function readDraft(userId: string, options: NewNoteOptions, now: Date = new Date()): StoredDraft | null {
  let parsed: unknown
  try {
    const stored = localStorage.getItem(draftStorageKey(userId))
    if (stored === null) return null
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.schema !== SCHEMA || parsed.userId !== userId || typeof parsed.savedAt !== "string") return null
  const savedAt = new Date(parsed.savedAt).getTime()
  if (!Number.isFinite(savedAt) || now.getTime() - savedAt > MAX_AGE_MS) return null
  const draft = sanitizeDraft(parsed.draft, options)
  return draft ? { draft, savedAt: parsed.savedAt } : null
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number, fallback = ""): string => (typeof value === "string" ? value.slice(0, max) : fallback)

function sanitizePart(value: unknown): NoteLinePart | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || !value.id || !value.name) return null
  return {
    id: value.id,
    sku: text(value.sku, 64),
    name: text(value.name, NEW_NOTE_DESCRIPTION_MAX),
    partNumber: typeof value.partNumber === "string" ? value.partNumber.slice(0, 80) : null,
    partBrand: typeof value.partBrand === "string" ? value.partBrand.slice(0, 80) : null,
    unitOfMeasure: text(value.unitOfMeasure, 40, NEW_NOTE_DEFAULT_UNIT) || NEW_NOTE_DEFAULT_UNIT,
  }
}

/**
 * Un borrador de fiar a partir de lo guardado: la forma se revisa campo a campo y lo que ya no existe en las opciones de hoy
 * (faena fuera del alcance, OT ya no abierta, equipo que cambió de faena, proveedor dado de baja) se suelta.
 */
export function sanitizeDraft(raw: unknown, options: NewNoteOptions): NoteDraft | null {
  if (!isRecord(raw)) return null
  const wanted = typeof raw.worksiteId === "string" ? raw.worksiteId : ""
  const worksiteId = options.worksites.some((item) => item.id === wanted) ? wanted : options.worksites.length === 1 ? options.worksites[0]!.id : ""
  const order = options.workOrders.find((item) => item.id === raw.workOrderId)
  const workOrderId = order && order.worksiteId === worksiteId ? order.id : ""

  const rawLines = Array.isArray(raw.lines) ? raw.lines.slice(0, NEW_NOTE_MAX_LINES) : []
  const lines: DraftLine[] = rawLines.filter(isRecord).map((line, index) => {
    const charge = typeof line.charge === "string" && chargeBelongsTo(options, line.charge, worksiteId) ? line.charge : ""
    const supplierId = typeof line.supplierId === "string" && options.suppliers.some((item) => item.id === line.supplierId) ? line.supplierId : ""
    return {
      key: `l${index + 1}`,
      description: text(line.description, NEW_NOTE_DESCRIPTION_MAX),
      part: sanitizePart(line.part),
      partNumber: text(line.partNumber, 80),
      quantity: text(line.quantity, 20, "1"),
      unit: text(line.unit, 40, NEW_NOTE_DEFAULT_UNIT) || NEW_NOTE_DEFAULT_UNIT,
      charge,
      supplierId,
    }
  })

  const opId = typeof raw.clientOpId === "string" ? raw.clientOpId : ""
  return {
    clientOpId: opId.length >= 8 && opId.length <= 64 ? opId : "",
    worksiteId,
    workOrderId,
    urgent: raw.urgent === true,
    notes: text(raw.notes, NEW_NOTE_NOTES_MAX),
    lines: lines.length ? lines : [newLine("l1", defaultCharge(options, workOrderId))],
  }
}
