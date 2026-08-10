import * as React from "react"
import { Badge } from "@/components/ui/badge"
import type { ItemStatus } from "@/lib/services/item-state"
import { cn } from "@/lib/utils"

/* ── State families ──────────────────────────────────────────────────────── */
type BadgeVariant = "default" | "primary" | "success" | "warning" | "signal" | "info" | "danger"

interface StateMeta {
  label:   string
  variant: BadgeVariant
  family:  "neutral" | "success" | "warning" | "signal" | "info" | "danger"
  /** Explicación en lenguaje llano para tooltip/leyenda (jerga de recepción). */
  description?: string
}

/**
 * Estados de ítem retirados del flujo: ninguno se produce ya, pero el historial
 * (`status_history`, EntityTimeline) conserva transiciones antiguas y debe
 * seguir legible. Mismo trato que `supplier_confirmed` en las OC. `returned`
 * ("devolver al solicitante") se sumó aquí el 2026-08-07: ya estaba muerto para
 * repuestos/servicios desde el 2026-07-29 y hoy dejó de producirse también
 * para EPP/otro — ningún tipo de solicitud puede alcanzarlo.
 */
type RetiredItemStatus = "postponed" | "returned"

/** Unified state vocabulary — every state in the system maps here. */
const ITEM_STATE_META: Record<ItemStatus | RetiredItemStatus, StateMeta> = {
  draft:               { label: "Borrador",           variant: "default",  family: "neutral"  },
  requested:           { label: "Solicitado",          variant: "default",  family: "neutral"  },
  approved:            { label: "Aprobado",            variant: "success",  family: "success"  },
  rejected:            { label: "Rechazado",           variant: "danger",   family: "danger"   },
  returned:            { label: "Devuelto",            variant: "warning",  family: "warning"  },
  postponed:           { label: "Postergado",          variant: "default",  family: "neutral"  },
  pending_purchase:    { label: "Pendiente compra",    variant: "signal",   family: "signal"   },
  in_purchase_order:   { label: "En OC",               variant: "info",     family: "info"     },
  purchased:           { label: "Comprado",            variant: "info",     family: "info"     },
  partially_received:  { label: "Recibido parcial",    variant: "warning",  family: "warning"  },
  received:            { label: "Recibido",            variant: "success",  family: "success"  },
  partially_delivered: { label: "Entrega parcial",     variant: "warning",  family: "warning"  },
  delivered:           { label: "Entregado",           variant: "success",  family: "success"  },
}

/* ── Request states ──────────────────────────────────────────────────────── */
export type RequestStatus =
  | "draft" | "submitted" | "in_review" | "partially_approved"
  | "approved" | "rejected" | "returned" | "in_purchasing"
  | "closed" | "cancelled"

const REQUEST_STATE_META: Record<RequestStatus, StateMeta> = {
  draft:              { label: "Borrador",             variant: "default",  family: "neutral"  },
  submitted:          { label: "Enviada",              variant: "info",     family: "info"     },
  in_review:          { label: "En revisión",          variant: "info",     family: "info"     },
  partially_approved: { label: "Aprob. parcial",       variant: "warning",  family: "warning"  },
  approved:           { label: "Aprobada",             variant: "success",  family: "success"  },
  rejected:           { label: "Rechazada",            variant: "danger",   family: "danger"   },
  // Estado retirado (2026-08-07): derivado del ítem, y ningún ítem puede estar
  // ya en `returned` — se conserva sólo para renderizar historial antiguo.
  returned:           { label: "Devuelta",             variant: "warning",  family: "warning"  },
  in_purchasing:      { label: "En proceso",           variant: "info",     family: "info"     },
  closed:             { label: "Cerrada",              variant: "default",  family: "neutral"  },
  cancelled:          { label: "Cancelada",            variant: "default",  family: "neutral"  },
}

/* ── OC states ───────────────────────────────────────────────────────────── */
export type OcStatus =
  | "draft" | "issued" | "sent" | "supplier_confirmed"
  | "partially_office_received" | "office_received"
  | "partially_received" | "received" | "closed" | "cancelled"

/**
 * Vocabulario de recepción (2026-08-07): tres etapas visibles —pendiente de
 * recepción, recibido en oficina, recibido en faena— y los parciales como
 * matiz de la misma etapa, no como estados aparte.
 */
const OC_STATE_META: Record<OcStatus, StateMeta> = {
  draft:              { label: "Borrador",             variant: "default",  family: "neutral", description: "OC en preparación: se puede revisar e imprimir antes de emitirla y enviarla." },
  sent:               { label: "Pendiente de recepción", variant: "info",   family: "info",    description: "OC emitida y enviada al proveedor; a la espera de que llegue la mercadería." },
  partially_office_received: { label: "Recibido en oficina (parcial)", variant: "warning", family: "warning", description: "Parte de los ítems llegó a oficina Chome; falta el saldo." },
  office_received:    { label: "Recibido en oficina",  variant: "info",     family: "info",    description: "Los ítems llegaron a oficina Chome, aún no despachados a faena." },
  partially_received: { label: "Recibido en faena (parcial)", variant: "warning", family: "warning", description: "Parte de los ítems se recibió en faena; falta el saldo." },
  received:           { label: "Recibido en faena",    variant: "success",  family: "success", description: "Todos los ítems recibidos en faena." },
  closed:             { label: "Completada",           variant: "success",  family: "success", description: "OC completada: recepción finalizada, sin acciones pendientes." },
  cancelled:          { label: "Anulada",              variant: "danger",   family: "danger",  description: "OC anulada." },
  // Estados retirados del flujo: ninguna OC nueva los alcanza, pero el historial
  // conserva transiciones antiguas y debe seguir legible.
  issued:             { label: "Emitida",              variant: "info",     family: "info",    description: "OC emitida sin enviar todavía (estado retirado: hoy emitir y enviar es un solo paso)." },
  supplier_confirmed: { label: "Confirmada",           variant: "primary",  family: "success", description: "El proveedor confirmó la orden (estado retirado)." },
}

/* ── Feedback (Soporte) states ───────────────────────────────────────────── */
export type FeedbackEstado = "abierto" | "en_progreso" | "resuelto" | "descartado"
export type FeedbackTipo   = "bug" | "consulta" | "sugerencia"

export const FEEDBACK_ESTADO_META: Record<FeedbackEstado, StateMeta> = {
  abierto:     { label: "Abierto",      variant: "info",    family: "info"    },
  en_progreso: { label: "En progreso",  variant: "warning", family: "warning" },
  resuelto:    { label: "Resuelto",     variant: "success", family: "success" },
  descartado:  { label: "Descartado",   variant: "default", family: "neutral" },
}

export const FEEDBACK_TIPO_LABELS: Record<FeedbackTipo, string> = {
  bug:        "Bug",
  consulta:   "Consulta",
  sugerencia: "Sugerencia",
}

/* ── PPA states ──────────────────────────────────────────────────────────── */
const PPA_STATE_META: Record<string, StateMeta> = {
  submitted:     { label: "Por revisar",       variant: "warning", family: "warning" },
  autorizado:    { label: "Autorizado",        variant: "success", family: "success" },
  detenido:      { label: "Detenido",          variant: "danger",  family: "danger"  },
  rechazado:     { label: "Rechazado",         variant: "danger",  family: "danger"  },
  aprobado_auto: { label: "Aprob. auto",       variant: "info",    family: "info"    },
  en_correccion: { label: "En corrección",     variant: "warning", family: "warning" },
  cerrado:       { label: "Cerrado",           variant: "default", family: "neutral" },
}

/* ── Combustibles states ─────────────────────────────────────────────────── */
const FUEL_STATE_META: Record<string, StateMeta> = {
  submitted:   { label: "Recibida",    variant: "info",    family: "info"    },
  observed:    { label: "Observada",   variant: "warning", family: "warning" },
  validated:   { label: "Validada",    variant: "success", family: "success" },
  voided:      { label: "Anulada",     variant: "danger",  family: "danger"  },
  draft:       { label: "Borrador",    variant: "default", family: "neutral" },
  registered:  { label: "Registrada",  variant: "info",    family: "info"    },
  reconciled:  { label: "Conciliada",  variant: "success", family: "success" },
  cancelled:   { label: "Anulada",     variant: "danger",  family: "danger"  },
}

/* ── Guía de Despacho Interna (GDI) states ───────────────────────────────── */
export type DispatchGuideStatus = "draft" | "dispatched" | "received" | "cancelled"

const DISPATCH_GUIDE_STATE_META: Record<DispatchGuideStatus, StateMeta> = {
  draft:      { label: "Borrador",   variant: "default", family: "neutral", description: "Guía en preparación: se puede editar y todavía no descontó stock de la oficina." },
  dispatched: { label: "Despachada", variant: "info",    family: "info",    description: "Los bienes salieron de la oficina hacia la faena; el stock ya se movió." },
  received:   { label: "Recibida",   variant: "success", family: "success", description: "La faena confirmó la recepción de los bienes. No vuelve a mover stock." },
  cancelled:  { label: "Anulada",    variant: "danger",  family: "danger",  description: "Guía anulada con motivo registrado; si había salida de stock, se revirtió con movimientos nuevos." },
}

/* ── StateBadge component ────────────────────────────────────────────────── */
type EntityType = "item" | "request" | "oc" | "feedback" | "ppa" | "fuel_log" | "fleet" | "prevention" | "dispatch_guide"

interface StateBadgeProps {
  state:      string
  entity?:    EntityType
  size?:      "sm" | "default" | "lg"
  className?: string
  dot?:       boolean
}

function getStateMeta(state: string, entity: EntityType): StateMeta {
  switch (entity) {
    case "request":  return REQUEST_STATE_META[state as RequestStatus]   ?? { label: state, variant: "default", family: "neutral" }
    case "oc":       return OC_STATE_META[state as OcStatus]             ?? { label: state, variant: "default", family: "neutral" }
    case "feedback": return FEEDBACK_ESTADO_META[state as FeedbackEstado] ?? { label: state, variant: "default", family: "neutral" }
    case "ppa":      return PPA_STATE_META[state]                        ?? { label: state, variant: "default", family: "neutral" }
    case "fuel_log": return FUEL_STATE_META[state]                       ?? { label: state, variant: "default", family: "neutral" }
    case "dispatch_guide": return DISPATCH_GUIDE_STATE_META[state as DispatchGuideStatus] ?? { label: state, variant: "default", family: "neutral" }
    default:         return ITEM_STATE_META[state as ItemStatus]          ?? { label: state, variant: "default", family: "neutral" }
  }
}

export function StateBadge({
  state,
  entity = "item",
  size = "default",
  className,
  dot = true,
}: StateBadgeProps) {
  const meta = getStateMeta(state, entity)
  return (
    <Badge
      variant={meta.variant}
      size={size}
      dot={dot}
      title={meta.description}
      className={cn(
        meta.family === "signal" && "border-[1.5px]",
        className,
      )}
    >
      {meta.label}
    </Badge>
  )
}

/* ── Exports for external use ─────────────────────────────────────────────── */
export { ITEM_STATE_META, REQUEST_STATE_META, OC_STATE_META, PPA_STATE_META, FUEL_STATE_META, DISPATCH_GUIDE_STATE_META }
