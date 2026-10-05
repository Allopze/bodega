/* ── Formateo legible de la línea de tiempo del activo (TIUX-13) ────────────
 * `it_asset_history` guarda `detail` (texto con enums crudos, escrito por cada
 * servicio) y `changes` (JSON con IDs internos). La ficha pintaba ambos tal cual
 * —un `<pre>` con `{"assignmentId": "..."}`—. Este módulo los convierte en
 * título + líneas "Campo: antes → después" + enlaces, con las etiquetas de
 * `constants.ts`.
 *
 * Funciona sobre historial ya guardado: `detail` antiguo trae enums crudos
 * ("disponible → en_reparacion"), así que además de leer `changes` se reemplazan
 * los tokens conocidos del texto. Vocabulario puro, sin `@/db`: lo usa un
 * componente de cliente. */

import { formatDate, formatCLP } from "@/lib/utils"
import {
  IT_ASSET_STATUS_META, IT_ASSIGNMENT_KIND_META, IT_MAINTENANCE_TYPE_META,
  IT_PHYSICAL_STATE_META, IT_RETIREMENT_REASON_META, IT_TICKET_STATUS_META,
} from "./constants"

export interface HistoryEventInput {
  action: string
  detail: string
  /** JSON guardado (string) o ya parseado; `null` si el evento no lo trae. */
  changes: string | Record<string, unknown> | null
  createdAt: string
  actorName?: string | null
}

export interface HistoryLine {
  label: string
  /** Valor único ("Motivo: robo"). */
  value?: string
  /** Par antes → después. */
  before?: string
  after?: string
}

export interface HistoryLink {
  label: string
  href: string
}

export interface HistoryEventView {
  title: string
  /** Frase corta del evento, ya sin enums ni fechas ISO. Vacía si las líneas lo dicen todo. */
  summary: string
  lines: HistoryLine[]
  links: HistoryLink[]
  /** Fecha en que ocurrió lo registrado (mantención, baja, entrega), si se conoce. */
  eventDate: string | null
  /** Fecha de registro en el sistema (siempre disponible). */
  recordedAt: string
  actorName: string | null
}

export const HISTORY_ACTION_LABELS: Record<string, string> = {
  created: "Ingreso",
  assigned: "Asignación",
  returned: "Devolución",
  status_changed: "Cambio de estado",
  edited: "Edición de datos",
  maintenance: "Mantención",
  maintenance_voided: "Mantención anulada",
  ticket: "Ticket",
  document: "Documento",
  photo: "Fotografía",
  warranty: "Garantía",
  retired: "Baja",
  retirement_reversed: "Baja revertida",
}

const ACCEPTANCE_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aceptada: "Aceptada",
  sin_acuse: "Sin acuse",
}

const EDIT_FIELD_LABELS: Record<string, string> = {
  brand: "Marca",
  model: "Modelo",
  serialNumber: "N.º de serie",
  cost: "Costo",
  warrantyEndDate: "Fin de garantía",
}

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g

function statusLabel(v: unknown): string {
  const key = String(v ?? "")
  return IT_ASSET_STATUS_META[key]?.label ?? key
}

function parseChanges(raw: HistoryEventInput["changes"]): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === "object") return raw
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

function isoDatesToLocal(text: string): string {
  return text.replace(ISO_DATE, (m) => formatDate(m))
}

/** Fecha civil (`YYYY-MM-DD`) o `null`: solo se acepta una fecha plana válida. */
function plainDate(v: unknown): string | null {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * Reemplaza los enums crudos que los servicios dejaron escritos en `detail`.
 * Solo en posiciones conocidas (después de "→", entre paréntesis, tras
 * "Estado físico:"): reemplazar palabras sueltas pisaría texto libre (el asunto
 * de un ticket que diga "nuevo").
 */
function humanizeDetail(action: string, detail: string): string {
  let text = detail
  if (action === "status_changed" || action === "retirement_reversed") {
    text = text.replace(/\b([a-z_]+) → ([a-z_]+)\b/g, (_m, a: string, b: string) => `${statusLabel(a)} → ${statusLabel(b)}`)
  }
  if (action === "ticket") {
    const tk = (v: string) => IT_TICKET_STATUS_META[v]?.label ?? v
    text = text.replace(/\b([a-z_]+) → ([a-z_]+)\b/g, (_m, a: string, b: string) => `${tk(a)} → ${tk(b)}`)
  }
  if (action === "maintenance" || action === "maintenance_voided") {
    text = text.replace(/^Mantención ([a-zñ]+)/i, (m, t: string) => {
      const label = IT_MAINTENANCE_TYPE_META[t.toLowerCase()]
      return label ? `Mantención ${label.toLowerCase()}` : m
    })
  }
  if (action === "retired" || action === "retirement_reversed") {
    text = text.replace(/\(([a-zñ]+)\)/i, (m, r: string) => {
      const label = IT_RETIREMENT_REASON_META[r.toLowerCase()]
      return label ? `(${label.toLowerCase()})` : m
    })
  }
  if (action === "returned") {
    text = text.replace(/Estado físico: ([a-z]+)/i, (m, s: string) => {
      const label = IT_PHYSICAL_STATE_META[s.toLowerCase()]?.label
      return label ? `Estado físico: ${label.toLowerCase()}` : m
    })
  }
  return isoDatesToLocal(text)
}

/** Fecha del evento dentro de un `detail` antiguo ("(2026-09-02)", "Fecha: 2026-09-03"). */
function eventDateFromDetail(action: string, detail: string): string | null {
  if (action === "maintenance") return plainDate(/\((\d{4}-\d{2}-\d{2})\)/.exec(detail)?.[1])
  if (action === "retired") return plainDate(/Fecha: (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1])
  return null
}

export function formatHistoryEvent(event: HistoryEventInput): HistoryEventView {
  const ch = parseChanges(event.changes)
  const lines: HistoryLine[] = []
  const links: HistoryLink[] = []
  let summary = humanizeDetail(event.action, event.detail)
  let eventDate: string | null = eventDateFromDetail(event.action, event.detail)

  const assignmentLink = (id: unknown, code: unknown, prefix = "Acta") => {
    const assignmentId = str(id)
    if (assignmentId) links.push({ label: `${prefix} ${str(code) ?? ""}`.trim(), href: `/ti/actas/${assignmentId}/print` })
  }

  switch (event.action) {
    case "status_changed": {
      if (ch.from !== undefined && ch.to !== undefined) {
        lines.push({ label: "Estado", before: statusLabel(ch.from), after: statusLabel(ch.to) })
        summary = "" // la línea de estado ya lo dice
      }
      const reason = str(ch.reason)
      if (reason) lines.push({ label: "Motivo", value: reason })
      break
    }
    case "edited": {
      const from = (ch.from && typeof ch.from === "object" ? ch.from : {}) as Record<string, unknown>
      const to = (ch.to && typeof ch.to === "object" ? ch.to : {}) as Record<string, unknown>
      for (const [key, label] of Object.entries(EDIT_FIELD_LABELS)) {
        const a = from[key] ?? null
        const b = to[key] ?? null
        // El formulario manda "" para un campo vacío y la BD guarda null: no son un cambio.
        if ((a ?? "") === (b ?? "")) continue
        const fmt = (v: unknown) => {
          if (v === null || v === "") return "—"
          if (key === "cost") return formatCLP(Number(v))
          if (key === "warrantyEndDate") return formatDate(String(v))
          return String(v)
        }
        lines.push({ label, before: fmt(a), after: fmt(b) })
      }
      break
    }
    case "assigned": {
      if (ch.kind) lines.push({ label: "Tipo", value: IT_ASSIGNMENT_KIND_META[String(ch.kind)] ?? String(ch.kind) })
      if (ch.acceptanceStatus) {
        lines.push({ label: "Acuse", value: ACCEPTANCE_LABELS[String(ch.acceptanceStatus)] ?? String(ch.acceptanceStatus) })
        const note = str(ch.note)
        if (note) lines.push({ label: "Nota", value: note })
      }
      assignmentLink(ch.assignmentId, ch.assignmentCode)
      assignmentLink(ch.newAssignmentId, ch.newAssignmentCode, "Nueva acta")
      assignmentLink(ch.fromAssignmentId, null, "Acta anterior")
      eventDate = plainDate(ch.deliveredAt) ?? eventDate
      break
    }
    case "returned": {
      if (ch.returnPhysicalState) {
        lines.push({ label: "Estado físico al devolver", value: IT_PHYSICAL_STATE_META[String(ch.returnPhysicalState)]?.label ?? String(ch.returnPhysicalState) })
      }
      if (ch.nextStatus) lines.push({ label: "Queda como", value: statusLabel(ch.nextStatus) })
      assignmentLink(ch.assignmentId, null)
      break
    }
    case "maintenance":
    case "maintenance_voided": {
      if (event.action === "maintenance" && typeof ch.cost === "number" && ch.cost > 0) {
        lines.push({ label: "Costo", value: formatCLP(ch.cost) })
      }
      if (event.action === "maintenance_voided") {
        const reason = str(ch.voidReason)
        if (reason) lines.push({ label: "Motivo de la anulación", value: reason })
        if (typeof ch.cost === "number") lines.push({ label: "Costo revertido", value: formatCLP(ch.cost) })
      }
      // El enlace lleva a la pestaña, donde vive el detalle de la mantención.
      if (str(ch.maintenanceId)) links.push({ label: "Ver mantenciones", href: "?tab=mantenciones" })
      break
    }
    case "ticket": {
      const reason = str(ch.reason)
      if (reason) lines.push({ label: "Motivo", value: reason })
      const ticketId = str(ch.ticketId)
      if (ticketId) links.push({ label: `Ticket ${str(ch.ticketCode) ?? ""}`.trim(), href: `/ti/tickets/${ticketId}` })
      break
    }
    case "retired": {
      if (ch.reason) lines.push({ label: "Motivo", value: IT_RETIREMENT_REASON_META[String(ch.reason)] ?? String(ch.reason) })
      if (ch.targetStatus) lines.push({ label: "Estado resultante", value: statusLabel(ch.targetStatus) })
      links.push({ label: "Ver en Bajas", href: "/ti/bajas" })
      break
    }
    case "retirement_reversed": {
      if (ch.from !== undefined && ch.to !== undefined) {
        lines.push({ label: "Estado", before: statusLabel(ch.from), after: statusLabel(ch.to) })
      }
      const reason = str(ch.reverseReason)
      if (reason) lines.push({ label: "Motivo de la reversión", value: reason })
      const code = str(ch.reopenedAssignmentCode)
      if (code) assignmentLink(ch.reopenedAssignmentId, code, "Acta reabierta")
      links.push({ label: "Ver en Bajas", href: "/ti/bajas" })
      break
    }
    case "document": {
      if (typeof ch.fileSize === "number") {
        const kb = ch.fileSize / 1024
        lines.push({ label: "Tamaño", value: kb >= 1024 ? `${(kb / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(kb))} KB` })
      }
      break
    }
    default:
      break
  }

  return {
    title: HISTORY_ACTION_LABELS[event.action] ?? "Movimiento",
    summary,
    lines,
    links,
    eventDate,
    recordedAt: event.createdAt,
    actorName: event.actorName ?? null,
  }
}
