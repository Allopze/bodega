import * as React from "react"
import { Badge } from "@/components/ui/badge"
import type { ItemStatus } from "@/lib/services/item-state"
import { cn } from "@/lib/utils"
import type { VariantProps } from "class-variance-authority"
import { badgeVariants } from "@/components/ui/badge"
import { FEEDBACK_ESTADO_LABELS, FEEDBACK_TIPO_LABELS } from "@/lib/validation/feedback"
import type { FeedbackEstado, FeedbackTipo } from "@/lib/validation/feedback"
export type { FeedbackEstado, FeedbackTipo }
export { FEEDBACK_TIPO_LABELS }

/* ── Vocabulario canónico de la cadena de adquisición (ADQ-10) ───────────────
 * solicitud → ítem → OC → recepción → guía. Antes "esperando al proveedor" tenía
 * siete nombres (Pendiente de recepción / Por recibir / Pendiente recepción /
 * Esperando recepción en oficina o bodega / En proceso / En curso / Comprado) y
 * Recepción ponía dos de ellos como pestañas vecinas. Un concepto, un nombre.
 * Los enums de BD no cambian; esto es sólo lo que se lee en pantalla.
 *
 *   Concepto                                 | Nombre canónico
 *   -----------------------------------------|---------------------------------
 *   OC enviada, el proveedor aún no entrega  | Pendiente de recepción
 *     (ítem `purchased`, línea de OC sin recibir) | (mismo nombre en ítem, OC y panel)
 *   OC preparada, sin emitir                 | Borrador (OC) · "OC por emitir" (ítem)
 *   Mercadería ya en oficina, sin despachar  | Recibido en oficina
 *   Guía armada, sin despachar               | Borrador (guía) · "Pendiente de despacho" (bandeja)
 *   Guía salió de oficina, faena no confirmó | Despachada · acción: "Confirmar llegada a faena"
 *   Llegó a faena (todo)                     | Recibido en faena (OC) · Recibido (ítem) · Recibida (guía)
 *   Solicitud con la cadena en marcha        | En curso (paraguas; el detalle está por ítem)
 *   Cola de Recepción (todas las abiertas)   | "Por atender" (pestaña) — nunca "Por recibir"
 *
 * Verbos: "Confirmar llegada a faena" (antes Cotejar / Cotejar en faena / Cotejar
 * entrega en faena / Completar guía) y "Completar despacho" para la guía en
 * borrador. "Cotejar" es jerga de bodega: queda sólo en comentarios y servicios.
 */

/* ── State families ──────────────────────────────────────────────────────── */
/* Derivado de `badgeVariants` (badge.tsx): una sola fuente para la lista de
 * variantes — incluir "neutral"/"outline" aquí fue exactamente lo que una
 * lista manual deja pasar. */
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

interface StateMeta {
  label:   string
  variant: BadgeVariant
  family:  "neutral" | "success" | "warning" | "signal" | "info" | "danger"
  /** Explicación en lenguaje llano para tooltip/leyenda (jerga de recepción). */
  description?: string
}

/**
 * Marcador para el nombre de la faena-oficina dentro de una descripción.
 *
 * Estos mapas son constantes que consumen ~30 archivos; volverlos funciones para
 * que un tooltip diga el nombre real obligaría a enhebrar ese dato por todos.
 * Con un marcador, quien lo tenga a mano lo sustituye (`describeState`) y el
 * resto lee un genérico correcto en vez de un literal que envejece.
 */
const OFFICE_TOKEN = "{oficina}"

/** La descripción con el nombre real de la oficina si se conoce, o genérica. */
export function describeState(description: string | undefined, officeName?: string): string | undefined {
  return description?.replaceAll(OFFICE_TOKEN, officeName ?? "la oficina")
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

/*
 * TRV-03 — qué variante lleva cada estado de la cadena de adquisición.
 *
 * El `Badge` rinde las severidades (signal/warning/danger/success…) en mono
 * MAYÚSCULAS y las variantes de prosa (default/info) en caja normal. Antes el
 * mapa le daba el grito a lo ya cerrado (APROBADA, RECIBIDA, ANULADA,
 * COMPLETADA) y el susurro a lo que pide acción (Borrador de OC, Despachada,
 * Pendiente de recepción). La regla, que aplica a ITEM, REQUEST, OC y GUÍA:
 *
 *   signal  = alguien de la organización debe actuar AHORA: quien aprueba debe
 *             decidir; quien compra debe emitir la OC borrador o generar la OC
 *             de una solicitud aprobada; quien recibe debe registrar la llegada
 *             de una OC enviada; la oficina debe despachar lo que llegó; la
 *             faena debe confirmar una guía despachada. (DESIGN.md: naranja
 *             signal reservado a lo pendiente.)
 *   warning = parcial o discrepancia que alguien debe revisar.
 *   danger  = desenlace negativo NO rutinario que el usuario debe notar
 *             (Rechazada/Rechazado). Anulada/Cancelada es rutina: no alarma.
 *   default = (prosa calma) estados terminales (Completada, Recibido en faena,
 *             Recibida, Cerrada, Entregado, Anulada, Cancelada) y borradores
 *             privados que nadie más puede mover (borrador de solicitud).
 *   info    = (prosa) en marcha esperando a un tercero, sin acción interna.
 *
 * `family` sigue a `variant` (se usa para el borde de los `signal`).
 */

/** Unified state vocabulary — every state in the system maps here. */
const ITEM_STATE_META: Record<ItemStatus | RetiredItemStatus, StateMeta> = {
  draft:               { label: "Borrador",           variant: "default",  family: "neutral"  },
  // Quien aprueba debe decidir.
  requested:           { label: "Solicitado",          variant: "signal",   family: "signal"   },
  // Aprobado y sin OC: quien compra debe generarla.
  approved:            { label: "Aprobado",            variant: "signal",   family: "signal"   },
  rejected:            { label: "Rechazado",           variant: "danger",   family: "danger"   },
  returned:            { label: "Devuelto",            variant: "warning",  family: "warning"  },
  postponed:           { label: "Postergado",          variant: "default",  family: "neutral"  },
  pending_purchase:    { label: "Pendiente compra",    variant: "signal",   family: "signal"   },
  // ADQ-07: el ítem de una OC en Borrador no está "pendiente de recepción"
  // —nada salió al proveedor—: lo que falta es emitirla.
  in_purchase_order:   { label: "OC por emitir",       variant: "signal",   family: "signal"   },
  // ADQ-10: "Comprado" era el 7º nombre de "esperando al proveedor".
  purchased:           { label: "Pendiente de recepción", variant: "signal", family: "signal"  },
  partially_office_received: { label: "Recibido en oficina (parcial)", variant: "warning", family: "warning" },
  // La oficina debe despachar lo que llegó.
  office_received:     { label: "Recibido en oficina", variant: "signal",   family: "signal"   },
  partially_received:  { label: "Recibido parcial",    variant: "warning",  family: "warning"  },
  received:            { label: "Recibido",            variant: "default",  family: "neutral"  },
  partially_delivered: { label: "Entrega parcial",     variant: "warning",  family: "warning"  },
  delivered:           { label: "Entregado",           variant: "default",  family: "neutral"  },
}

/* ── Request states ──────────────────────────────────────────────────────── */
export type RequestStatus =
  | "draft" | "submitted" | "in_review" | "partially_approved"
  | "approved" | "rejected" | "returned" | "in_purchasing"
  | "closed" | "cancelled"

const REQUEST_STATE_META: Record<RequestStatus, StateMeta> = {
  draft:              { label: "Borrador",             variant: "default",  family: "neutral"  },
  // Quien aprueba debe decidir (la solicitante ya no puede hacer nada).
  submitted:          { label: "Enviada",              variant: "signal",   family: "signal"   },
  in_review:          { label: "En revisión",          variant: "signal",   family: "signal"   },
  partially_approved: { label: "Aprob. parcial",       variant: "warning",  family: "warning"  },
  // Aprobada y sin comprar: quien compra debe generar la OC.
  approved:           { label: "Aprobada",             variant: "signal",   family: "signal"   },
  rejected:           { label: "Rechazada",            variant: "danger",   family: "danger"   },
  // Estado retirado (2026-08-07): derivado del ítem, y ningún ítem puede estar
  // ya en `returned` — se conserva sólo para renderizar historial antiguo.
  returned:           { label: "Devuelta",             variant: "warning",  family: "warning"  },
  // ADQ-10: "En proceso" y "En curso" eran dos nombres del mismo paraguas; la
  // pestaña de Solicitudes ya dice "En curso".
  in_purchasing:      { label: "En curso",             variant: "info",     family: "info"     },
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
  // Quien compra debe emitirla.
  draft:              { label: "Borrador",             variant: "signal",   family: "signal",  description: "OC en preparación: se puede revisar e imprimir antes de emitirla. Al emitirla pasa a Recepción." },
  sent:               { label: "Pendiente de recepción", variant: "signal", family: "signal",  description: "OC emitida y enviada al proveedor; a la espera de que llegue la mercadería." },
  partially_office_received: { label: "Recibido en oficina (parcial)", variant: "warning", family: "warning", description: `Parte de los ítems llegó a ${OFFICE_TOKEN}; falta el saldo.` },
  office_received:    { label: "Recibido en oficina",  variant: "signal",   family: "signal",  description: `Los ítems llegaron a ${OFFICE_TOKEN}, aún no despachados a faena.` },
  partially_received: { label: "Recibido en faena (parcial)", variant: "warning", family: "warning", description: "Parte de los ítems se recibió en faena; falta el saldo." },
  received:           { label: "Recibido en faena",    variant: "default",  family: "neutral", description: "Todos los ítems recibidos en faena." },
  closed:             { label: "Completada",           variant: "default",  family: "neutral", description: "OC completada: recepción finalizada, sin acciones pendientes." },
  cancelled:          { label: "Anulada",              variant: "default",  family: "neutral", description: "OC anulada." },
  // Estados retirados del flujo: ninguna OC nueva los alcanza, pero el historial
  // conserva transiciones antiguas y debe seguir legible.
  issued:             { label: "Emitida",              variant: "info",     family: "info",    description: "OC emitida sin enviar todavía (estado retirado: hoy emitir y enviar es un solo paso)." },
  supplier_confirmed: { label: "Confirmada",           variant: "primary",  family: "success", description: "El proveedor confirmó la orden (estado retirado)." },
}

/* ── Feedback (Soporte) states ───────────────────────────────────────────── */
/* Los labels viven en lib/validation/feedback (single source sin "use client");
 * aquí sólo se agrega el variant/family de presentación. */
export const FEEDBACK_ESTADO_META: Record<FeedbackEstado, StateMeta> = {
  abierto:     { label: FEEDBACK_ESTADO_LABELS.abierto,     variant: "info",    family: "info"    },
  en_progreso: { label: FEEDBACK_ESTADO_LABELS.en_progreso, variant: "warning", family: "warning" },
  resuelto:    { label: FEEDBACK_ESTADO_LABELS.resuelto,    variant: "success", family: "success" },
  descartado:  { label: FEEDBACK_ESTADO_LABELS.descartado,  variant: "default", family: "neutral" },
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
export type DispatchGuideStatus = "draft" | "dispatched" | "partially_received" | "received" | "cancelled"

const DISPATCH_GUIDE_STATE_META: Record<DispatchGuideStatus, StateMeta> = {
  // La oficina debe completar el despacho.
  draft:      { label: "Borrador",   variant: "signal",  family: "signal",  description: "Guía en preparación: se puede editar y todavía no descontó stock de la oficina." },
  // TRV-03: "Despachada" usaba `info` (susurro) siendo lo que la faena debe confirmar.
  dispatched: { label: "Despachada", variant: "signal",  family: "signal",  description: "Los bienes salieron de la oficina hacia la faena; falta que la faena confirme la llegada. El stock ya se movió." },
  partially_received: { label: "Recibida con diferencia", variant: "warning", family: "warning", description: "La faena revisó la guía, pero una o más cantidades no coinciden con lo despachado." },
  received:   { label: "Recibida",   variant: "default", family: "neutral", description: "La faena confirmó la recepción de los bienes. No vuelve a mover stock." },
  cancelled:  { label: "Anulada",    variant: "default", family: "neutral", description: "Guía anulada con motivo registrado; si había salida de stock, se revirtió con movimientos nuevos." },
}

/* ── StateBadge component ────────────────────────────────────────────────── */
type EntityType = "item" | "request" | "oc" | "feedback" | "ppa" | "fuel_log" | "fleet" | "prevention" | "dispatch_guide"

interface StateBadgeProps {
  state:      string
  entity?:    EntityType
  size?:      "sm" | "default" | "lg"
  className?: string
  dot?:       boolean
  /** Nombre real de la faena-oficina, si quien renderiza lo tiene resuelto. */
  officeName?: string
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
  officeName,
}: StateBadgeProps) {
  const meta = getStateMeta(state, entity)
  return (
    <Badge
      variant={meta.variant}
      size={size}
      dot={dot}
      title={describeState(meta.description, officeName)}
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

/* ── MetaBadge: vocabulario de estado fuera de las entidades canónicas ────── */

/**
 * `{ label, variant }` con los mismos valores de `variant` que acepta `Badge`.
 *
 * Los módulos sin estado canónico (conciliación TAE/TCT, SII, garantías,
 * bloqueos de seguridad, privacidad) solían copiar el mapa `label → { label,
 * variant }` y re-decidir el color: el mismo concepto "pendiente" renderizaba
 * `warning` en un módulo y `signal` en otro. MetaBadge reutiliza el vocabulario
 * de `StateMeta` para que el color lo decida la familia del estado, una sola vez.
 */
export interface StateMetaInput {
  label: string
  variant: BadgeVariant
}

/** Mapea un estado cualquiera a su meta; si no está en el mapa, lo muestra tal cual en neutro. */
export function metaFor(
  map: Record<string, StateMetaInput>,
  state: string | null | undefined,
): StateMetaInput {
  if (state == null) return { label: "—", variant: "default" }
  return map[state] ?? { label: state, variant: "default" }
}

interface MetaBadgeProps extends Omit<React.ComponentProps<typeof Badge>, "variant"> {
  meta: StateMetaInput
  /** Nombre real de la faena-oficina u contexto, si quien renderiza lo tiene. */
  title?: string
}

/** Badge que recibe la meta `{ label, variant }` ya resuelta (ver `metaFor`). */
export function MetaBadge({ meta, size = "default", title, className, children, ...props }: MetaBadgeProps) {
  return (
    <Badge
      variant={meta.variant}
      size={size}
      title={title}
      className={cn(meta.variant === "signal" && "border-[1.5px]", className)}
      {...props}
    >
      {children ?? meta.label}
    </Badge>
  )
}
