import { MANT_PARTS_NOTE_MAX_LINES } from "@/lib/mantencion/contracts"
import type { NewNoteOptions, NewNoteVehicle } from "@/lib/services/mantencion/parts-notes/new-note-options"

/**
 * Modelo del formulario «Nueva nota de pedido» (web): el borrador, sus cambios de faena y de OT, la validación previa al
 * envío y la forma que se manda al servidor. Sin React ni almacenamiento (`new-note-storage.ts`): todo es puro y se
 * prueba solo. El servidor vuelve a validar cada cosa (`nueva/actions.ts` y `createPartsNote`).
 *
 * El cargo de una línea viaja en un solo valor de selector: `v:<equipo>`, `c:<centro de costo>` o vacío. Así «equipo o centro
 * de costo, no los dos» no se puede violar desde la pantalla.
 */

export const NEW_NOTE_MAX_LINES = MANT_PARTS_NOTE_MAX_LINES
export const NEW_NOTE_DEFAULT_UNIT = "unidad"
export const NEW_NOTE_DESCRIPTION_MAX = 300
export const NEW_NOTE_NOTES_MAX = 500

/** El repuesto del catálogo que se eligió en una línea (lo justo para mostrarlo; el servidor vuelve a validarlo). */
export interface NoteLinePart {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
}

export interface DraftLine {
  /** Estable dentro de la pantalla: clave de React e id de sus campos. */
  key: string
  /** Lo que se pide: el nombre del repuesto elegido o el texto libre. */
  description: string
  part: NoteLinePart | null
  partNumber: string
  /** Texto tal como lo escribe la persona (admite coma decimal). */
  quantity: string
  unit: string
  /** `""`, `v:<id de equipo>` o `c:<id de centro de costo>`. */
  charge: string
  supplierId: string
}

export interface NoteDraft {
  /** Una por borrador, conservada en cada reintento: el servidor la usa para no duplicar. */
  clientOpId: string
  worksiteId: string
  workOrderId: string
  urgent: boolean
  notes: string
  lines: DraftLine[]
}

/** Lo que recibe la acción de servidor (`createPartsNoteAction`). */
export interface NewNoteInput {
  clientOpId: string
  worksiteId: string
  workOrderId: string | null
  urgent: boolean
  notes: string | null
  lines: Array<{
    description: string
    quantity: number
    unitOfMeasure: string
    partNumber: string | null
    productId: string | null
    chargeVehicleId: string | null
    chargeCostCenterId: string | null
    suggestedSupplierId: string | null
  }>
}

export function newLine(key: string, charge = ""): DraftLine {
  return { key, description: "", part: null, partNumber: "", quantity: "1", unit: NEW_NOTE_DEFAULT_UNIT, charge, supplierId: "" }
}

/** Un borrador vacío. Con una sola faena en el alcance, ya viene elegida. */
export function newDraft(options: NewNoteOptions, initial: { worksiteId?: string; workOrderId?: string } = {}): NoteDraft {
  const order = initial.workOrderId ? options.workOrders.find((item) => item.id === initial.workOrderId) : undefined
  const requested = order?.worksiteId ?? initial.worksiteId
  const worksiteId = requested && options.worksites.some((item) => item.id === requested)
    ? requested
    : options.worksites.length === 1 ? options.worksites[0]!.id : ""
  const workOrderId = order && order.worksiteId === worksiteId ? order.id : ""
  return {
    clientOpId: "",
    worksiteId,
    workOrderId,
    urgent: false,
    notes: "",
    lines: [newLine("l1", defaultCharge(options, workOrderId))],
  }
}

/** Un id de operación nuevo. `randomUUID` sólo existe en contextos seguros: sin él, uno aleatorio de igual largo máximo. */
export function newClientOpId(): string {
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID()
  const random = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("")
  return `np-${Date.now().toString(36)}-${random}`.slice(0, 64)
}

const isBlankLine = (line: DraftLine) => !line.description.trim() && !line.part && !line.partNumber.trim()

/** ¿Hay algo que valga la pena guardar como borrador? Una faena elegida o una línea intacta no cuentan. */
export function hasContent(draft: NoteDraft): boolean {
  return !!draft.workOrderId || draft.urgent || !!draft.notes.trim() || draft.lines.some((line) => !isBlankLine(line))
}

/** Quita las líneas vacías (siempre queda una). Devuelve el mismo borrador si no había ninguna que quitar. */
export function pruneBlankLines(draft: NoteDraft): NoteDraft {
  const kept = draft.lines.filter((line) => !isBlankLine(line))
  if (kept.length === draft.lines.length) return draft
  return { ...draft, lines: kept.length ? kept : [draft.lines[0]!] }
}

export const vehicleLabel = (vehicle: Pick<NewNoteVehicle, "code" | "plate">) =>
  vehicle.plate && vehicle.plate !== vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.code

/** Cargo por defecto de las líneas de una OT: su equipo, si hoy sigue en la faena de la OT (si no, el servidor lo rechazaría). */
export function defaultCharge(options: NewNoteOptions, workOrderId: string): string {
  const order = workOrderId ? options.workOrders.find((item) => item.id === workOrderId) : undefined
  if (!order) return ""
  return options.vehicles.some((vehicle) => vehicle.id === order.vehicleId && vehicle.worksiteId === order.worksiteId) ? `v:${order.vehicleId}` : ""
}

/** ¿El cargo (`v:`/`c:`) existe en esa faena? */
export function chargeBelongsTo(options: NewNoteOptions, charge: string, worksiteId: string): boolean {
  if (charge.startsWith("v:")) return options.vehicles.some((item) => item.id === charge.slice(2) && item.worksiteId === worksiteId)
  if (charge.startsWith("c:")) return options.costCenters.some((item) => item.id === charge.slice(2) && item.worksiteId === worksiteId)
  return false
}

/** Cambia de faena: lo que era de la faena anterior (la OT y el cargo de cada línea) se suelta. */
export function changeWorksite(draft: NoteDraft, worksiteId: string, options: NewNoteOptions): NoteDraft {
  if (worksiteId === draft.worksiteId) return draft
  const order = options.workOrders.find((item) => item.id === draft.workOrderId)
  return {
    ...draft,
    worksiteId,
    workOrderId: order && order.worksiteId === worksiteId ? draft.workOrderId : "",
    lines: draft.lines.map((line) => (line.charge && !chargeBelongsTo(options, line.charge, worksiteId) ? { ...line, charge: "" } : line)),
  }
}

/**
 * Elige (o quita) la OT. Su equipo pasa a ser el cargo de las líneas que no tenían otro; al quitarla o cambiarla, las que
 * llevaban el equipo de la OT anterior lo sueltan. Un cargo puesto a mano no se toca.
 */
export function changeWorkOrder(draft: NoteDraft, workOrderId: string, options: NewNoteOptions): NoteDraft {
  if (workOrderId === draft.workOrderId) return draft
  const order = workOrderId ? options.workOrders.find((item) => item.id === workOrderId) : undefined
  if (workOrderId && !order) return draft
  // La OT manda la faena: si no era la elegida, lo de la faena anterior (el cargo de cada línea) se suelta primero.
  const base = order && order.worksiteId !== draft.worksiteId ? changeWorksite(draft, order.worksiteId, options) : draft
  const before = defaultCharge(options, draft.workOrderId)
  const after = defaultCharge(options, workOrderId)
  return {
    ...base,
    workOrderId,
    lines: base.lines.map((line) => (!line.charge || line.charge === before ? { ...line, charge: after } : line)),
  }
}

/** «1,5» y «1.5» valen lo mismo. `null` si no es una cantidad válida (mayor que cero y hasta 100.000). */
export function parseQuantity(text: string): number | null {
  const normalized = text.trim().replace(",", ".")
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? value : null
}

/** Errores por campo (`worksiteId`, `lines.<n>.description`…) con los mismos textos que da el servidor. Vacío = se puede enviar. */
export function validateDraft(draft: NoteDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!draft.worksiteId) errors.worksiteId = "Elige la faena."
  if (draft.lines.length === 0 || draft.lines.every(isBlankLine)) errors.lines = "Agrega al menos un repuesto."
  draft.lines.forEach((line, index) => {
    if (line.description.trim().length < 3) errors[`lines.${index}.description`] = "Describe el repuesto (al menos 3 letras)."
    if (parseQuantity(line.quantity) === null) errors[`lines.${index}.quantity`] = "Indica una cantidad mayor que cero."
    if (!line.unit.trim()) errors[`lines.${index}.unit`] = "Indica la unidad."
  })
  return errors
}

/** El borrador tal como lo recibe el servidor. Quien lo llama ya validó (`validateDraft`) y quitó las líneas vacías. */
export function buildNoteInput(draft: NoteDraft): NewNoteInput {
  return {
    clientOpId: draft.clientOpId,
    worksiteId: draft.worksiteId,
    workOrderId: draft.workOrderId || null,
    urgent: draft.urgent,
    notes: draft.notes.trim() || null,
    lines: draft.lines.map((line) => ({
      description: line.description.trim(),
      quantity: parseQuantity(line.quantity) ?? 0,
      unitOfMeasure: line.unit.trim() || NEW_NOTE_DEFAULT_UNIT,
      partNumber: line.partNumber.trim() || null,
      productId: line.part?.id ?? null,
      chargeVehicleId: line.charge.startsWith("v:") ? line.charge.slice(2) : null,
      chargeCostCenterId: line.charge.startsWith("c:") ? line.charge.slice(2) : null,
      suggestedSupplierId: line.supplierId || null,
    })),
  }
}
