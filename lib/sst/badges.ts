/**
 * Shared badge helpers for SST evaluations.
 * Single source of truth for resultado labels/colors and action-plan estado options.
 * Used by both the list and the detail screens to ensure visual consistency.
 */

import type { BadgeProps } from "@/components/ui/badge"

// ── Motivo ───────────────────────────────────────────────────────────────────

export const MOTIVO_LABELS: Record<string, string> = {
  ingreso_nuevo:           "Ingreso nuevo",
  reincorporacion:         "Reincorporación",
  cambio_cargo:            "Cambio de cargo",
  post_incidente_persona:  "Post incidente: persona",
  post_incidente_ambiente: "Post incidente: ambiente",
  evaluacion_periodica:    "Evaluación periódica",
  solicitud_trabajador:    "Solicitud del trabajador",
}

// ── Resultado ────────────────────────────────────────────────────────────────

export const RESULTADO_LABELS: Record<string, string> = {
  habilitado_autonomo:      "Habilitado Autónomo",
  habilitado_restricciones: "Habilitado c/Restricciones",
  no_habilitado:            "No Habilitado",
  requiere_reforzamiento:   "Requiere Reforzamiento",
}

// ── Estado (evaluación) ──────────────────────────────────────────────────────

export function estadoLabel(estado: string): string {
  return estado === "cerrado" ? "Cerrado" : "Borrador"
}

// ── Action-plan item estado ───────────────────────────────────────────────────

export const ESTADO_OPTIONS: { value: string; label: string }[] = [
  { value: "pendiente",  label: "Pendiente"   },
  { value: "en_proceso", label: "En proceso"  },
  { value: "cerrado",    label: "Cerrado"      },
]

export const ESTADO_LABELS: Record<string, string> = Object.fromEntries(
  ESTADO_OPTIONS.map(({ value, label }) => [value, label])
)

// ── Variant-returning helpers (badge variant API) ──────────────────────────
// Non-optional: these feed `variant` inside `StateMetaInput` (MetaBadge), where
// undefined is not assignable.

type BadgeVariant = NonNullable<BadgeProps["variant"]>

export function resultadoBadgeVariant(resultado: string): BadgeVariant {
  switch (resultado) {
    case "habilitado_autonomo":      return "success"
    case "habilitado_restricciones": return "warning"
    case "no_habilitado":            return "danger"
    case "requiere_reforzamiento":   return "info"
    default:                         return "default"
  }
}

export function estadoBadgeVariant(estado: string): BadgeVariant {
  return estado === "cerrado" ? "default" : "signal"
}

export function tipoBadgeVariant(tipo: string): BadgeVariant {
  return tipo === "seguimiento" ? "info" : "default"
}

export function estadoPlanBadgeVariant(estado: string): BadgeVariant {
  switch (estado) {
    case "cerrado":    return "success"
    case "en_proceso": return "warning"
    default:           return "default"
  }
}
