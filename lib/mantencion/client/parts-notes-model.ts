import { isPartsNoteOpen, type CatalogPartsNote, type CatalogPartsNoteLine, type MantCatalog, type PartsNoteStatus } from "../contracts"
import { equipmentLabel } from "./fleet-view"
import { appliesOver, qtyText, type OtPartStage } from "./ot-model"
import type { QueueItem, QueuePartsNoteItem } from "./types"

/**
 * «Mis notas»: las notas de pedido de repuestos que pidió este usuario, con y sin OT, tal como las ve el mecánico.
 * Lo que el servidor dijo en el catálogo (`ownPartsNotes`) más lo que el teléfono aún no envió («Por enviar»). Todo
 * puro, sin red ni IndexedDB, y en palabras del taller: el estado de la nota y el de cada línea van siempre escritos
 * (nunca sólo en color), con el motivo a la vista cuando está en espera, rechazada, anulada o no se pudo enviar.
 *
 * Reglas:
 *  - Una nota del teléfono cuenta mientras no esté en el catálogo: pendiente o enviándose, siempre; enviada, sólo
 *    mientras el catálogo guardado sea más viejo que el envío (`appliesOver`); rechazada por el servidor, hasta que el
 *    mecánico la lee («Entendido»). Si el catálogo ya trae la nota (mismo `clientOpId`), manda el catálogo.
 *  - «Llegó 2 de 5» sale de lo que llegó a la faena para la línea (o se apartó del stock) y lo pedido.
 */

export type NoteTone = "wait" | "info" | "ok" | "bad"

/** Estado de una nota para el mecánico: los del servidor más los dos del teléfono. */
export type MyNoteState = PartsNoteStatus | "por_enviar" | "no_enviada"

export interface MyNoteLine {
  key: string
  description: string
  quantity: number
  unit: string
  stage: OtPartStage
  /** Lo ya usado de lo que llegó (sólo con OT): el ícono de la línea lo distingue de «llegó». */
  used: number
  /** «Por enviar», «Pedido», «En compra», «Llegó 2 de 5», «Rechazado: motivo». */
  label: string
  /** Aparte del estado: «Usado 1 de 2». */
  detail: string | null
  tone: NoteTone
  /** Ya llegó todo lo pedido de esta línea. */
  complete: boolean
}

export interface MyNote {
  /** Estable entre renders: el id de la nota del servidor o el de la cola. */
  key: string
  /** `NP-2026-0001`; `null` mientras está sólo en el teléfono. */
  code: string | null
  state: MyNoteState
  label: string
  detail: string
  tone: NoteTone
  /** Motivo a la vista: «En espera», «Rechazada», «Anulada» o el rechazo del envío. */
  reason: string | null
  /** Sigue en curso (no cerrada, rechazada ni anulada), o necesita que el mecánico la lea. */
  open: boolean
  urgent: boolean
  worksiteName: string | null
  workOrderFolio: string | null
  /** «KA-140 · SGCP-84» de la OT de la nota; `null` sin OT. */
  equipment: string | null
  observation: string | null
  createdAt: string
  lines: MyNoteLine[]
  /** Líneas que ya llegaron completas y líneas que se esperan (las rechazadas no cuentan). */
  arrivedLines: number
  expectedLines: number
  /** Id del elemento de la cola cuando la nota está (o estuvo) en el teléfono: con él se descarta un envío rechazado. */
  queueId: string | null
}

const STATE_TEXT: Record<MyNoteState, { label: string; detail: string; tone: NoteTone }> = {
  por_enviar: { label: "Por enviar", detail: "Guardada en el teléfono. Se envía cuando haya señal.", tone: "wait" },
  no_enviada: { label: "No se pudo enviar", detail: "La plataforma no aceptó el pedido.", tone: "bad" },
  enviada: { label: "Enviada", detail: "Esperando que jefatura la revise.", tone: "wait" },
  aceptada: { label: "Aceptada", detail: "Jefatura la aceptó y la va a resolver.", tone: "info" },
  en_espera: { label: "En espera", detail: "Jefatura la dejó en espera.", tone: "wait" },
  en_gestion: { label: "En gestión", detail: "Jefatura está resolviendo los repuestos.", tone: "info" },
  en_compra: { label: "En compra", detail: "Se están comprando los repuestos.", tone: "info" },
  recibida_parcial: { label: "Llegó una parte", detail: "Ya llegó parte de lo pedido.", tone: "info" },
  cerrada: { label: "Cerrada", detail: "Todo lo pedido llegó a la faena.", tone: "ok" },
  rechazada: { label: "Rechazada", detail: "Jefatura no aprobó ningún repuesto.", tone: "bad" },
  anulada: { label: "Anulada", detail: "La nota se anuló.", tone: "bad" },
}

/** La frase de una línea: lleva el estado en palabras y, si aporta, un detalle aparte («Usado 1 de 2»). */
export function noteLineText(line: Pick<CatalogPartsNoteLine, "quantity" | "arrived" | "used" | "rejectionReason"> & { stage: OtPartStage }): Pick<MyNoteLine, "label" | "detail" | "tone" | "complete"> {
  switch (line.stage) {
    case "por_enviar": return { label: "Por enviar", detail: null, tone: "wait", complete: false }
    case "pedido": return { label: "Pedido", detail: null, tone: "wait", complete: false }
    case "en_compra": return { label: "En compra", detail: null, tone: "info", complete: false }
    case "rechazado": return { label: line.rejectionReason ? `Rechazado: ${line.rejectionReason}` : "Rechazado", detail: null, tone: "bad", complete: false }
    case "en_bodega": {
      const complete = line.arrived >= line.quantity
      return {
        label: `Llegó ${qtyText(line.arrived)} de ${qtyText(line.quantity)}`,
        detail: line.used > 0 ? `Usado ${qtyText(line.used)} de ${qtyText(line.arrived)}` : null,
        tone: complete ? "ok" : "info",
        complete,
      }
    }
  }
}

function lineOf(line: CatalogPartsNoteLine): MyNoteLine {
  return { key: line.id, description: line.description, quantity: line.quantity, unit: line.unit, stage: line.stage, used: line.used, ...noteLineText(line) }
}

/** El motivo de una nota rechazada está en sus líneas (rechazar la nota rechaza las pendientes con el mismo motivo): uno solo si todas coinciden. */
function rejectionOf(lines: readonly CatalogPartsNoteLine[]): string | null {
  const reasons = [...new Set(lines.flatMap((line) => (line.stage === "rechazado" && line.rejectionReason ? [line.rejectionReason] : [])))]
  return reasons.length === 1 ? reasons[0]! : null
}

function progressOf(lines: readonly MyNoteLine[]): Pick<MyNote, "arrivedLines" | "expectedLines"> {
  const expected = lines.filter((line) => line.stage !== "rechazado")
  return { arrivedLines: expected.filter((line) => line.complete).length, expectedLines: expected.length }
}

function fromServer(note: CatalogPartsNote): MyNote {
  const text = STATE_TEXT[note.status]
  const lines = note.lines.map(lineOf)
  const reason = note.status === "rechazada" ? rejectionOf(note.lines) : note.statusReason ?? null
  const rejectedSome = note.status === "cerrada" && note.lines.some((line) => line.stage === "rechazado")
  return {
    key: note.id,
    code: note.code,
    state: note.status,
    label: text.label,
    detail: rejectedSome ? "Lo aprobado ya llegó a la faena." : text.detail,
    tone: text.tone,
    reason,
    open: isPartsNoteOpen(note.status),
    urgent: note.urgent ?? note.equipmentStopped,
    worksiteName: note.worksiteName ?? null,
    workOrderFolio: note.workOrderFolio ?? null,
    equipment: note.equipmentCode ? equipmentLabel({ code: note.equipmentCode, plate: note.equipmentPlate ?? note.equipmentCode }) : null,
    observation: note.notes ?? null,
    createdAt: note.createdAt,
    lines,
    ...progressOf(lines),
    queueId: null,
  }
}

function fromPhone(item: QueuePartsNoteItem, worksiteName: string | null): MyNote {
  const state: MyNoteState = item.status === "rejected" ? "no_enviada" : item.status === "sent" ? "enviada" : "por_enviar"
  const text = STATE_TEXT[state]
  const lines = item.payload.lines.map((line, index): MyNoteLine => ({
    key: `${item.id}:${index}`, description: line.description, quantity: line.quantity, unit: line.unitOfMeasure,
    stage: "por_enviar", used: 0, ...noteLineText({ stage: "por_enviar", quantity: line.quantity, arrived: 0, used: 0, rejectionReason: null }),
  }))
  const { summary } = item
  return {
    key: item.id,
    code: null,
    state,
    label: text.label,
    detail: text.detail,
    tone: text.tone,
    reason: state === "no_enviada" ? item.lastError ?? "La plataforma no aceptó el pedido de repuestos." : null,
    open: true,
    urgent: item.payload.urgent ?? item.payload.equipmentStopped,
    worksiteName: summary.worksiteName ?? worksiteName,
    workOrderFolio: summary.folio,
    equipment: summary.equipmentCode ? equipmentLabel({ code: summary.equipmentCode, plate: summary.equipmentPlate ?? summary.equipmentCode }) : null,
    observation: item.payload.notes,
    createdAt: item.payload.createdAt,
    lines,
    ...progressOf(lines),
    queueId: item.id,
  }
}

/**
 * Mis notas, de la más nueva a la más vieja. Primero las que están sólo en el teléfono (o no se pudieron enviar), después
 * las del servidor: así lo que el mecánico acaba de pedir queda a la vista.
 */
export function buildMyNotes(catalog: MantCatalog | null | undefined, queue: readonly QueueItem[], userId: string): MyNote[] {
  const known = catalog?.ownPartsNotes ?? []
  const knownOps = new Set(known.flatMap((note) => (note.clientOpId ? [note.clientOpId] : [])))
  const siteName = (id: string | undefined) => (id ? catalog?.worksites.find((site) => site.id === id)?.name ?? null : null)
  const phone = queue
    .filter((item): item is QueuePartsNoteItem => item.type === "parts_note" && item.authorUserId === userId && !knownOps.has(item.id))
    .filter((item) => item.status === "rejected" || appliesOver(item, catalog?.generatedAt))
    .map((item) => fromPhone(item, siteName(item.payload.worksiteId ?? undefined)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const server = known.map(fromServer).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return [...phone, ...server]
}

/** Abiertas (lo que sigue en curso o pide atención) y cerradas (cerrada, rechazada o anulada, ya sin nada por hacer). */
export function splitMyNotes(notes: readonly MyNote[]): { open: MyNote[]; closed: MyNote[] } {
  return { open: notes.filter((note) => note.open), closed: notes.filter((note) => !note.open) }
}
