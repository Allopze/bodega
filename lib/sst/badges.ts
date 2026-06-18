/**
 * Shared badge helpers for SST evaluations.
 * Single source of truth for resultado labels/colors and action-plan estado options.
 * Used by both the list and the detail screens to ensure visual consistency.
 */

// ── Resultado ────────────────────────────────────────────────────────────────

export const RESULTADO_LABELS: Record<string, string> = {
  habilitado_autonomo:      "Habilitado Autónomo",
  habilitado_restricciones: "Habilitado c/Restricciones",
  no_habilitado:            "No Habilitado",
  requiere_reforzamiento:   "Requiere Reforzamiento",
}

/** Returns a Tailwind className string for the resultado badge. */
export function resultadoBadgeClass(resultado: string): string {
  switch (resultado) {
    case "habilitado_autonomo":
      return "bg-emerald-100 text-emerald-800 border-emerald-200"
    case "habilitado_restricciones":
      return "bg-amber-100 text-amber-800 border-amber-200"
    case "no_habilitado":
      return "bg-rose-100 text-rose-800 border-rose-200"
    case "requiere_reforzamiento":
      return "bg-blue-100 text-blue-800 border-blue-200"
    default:
      return "bg-slate-100 text-slate-700 border-slate-200"
  }
}

// ── Estado (evaluación) ──────────────────────────────────────────────────────

/** Badge classes for evaluation estado (borrador / cerrado). */
export function estadoBadgeClass(estado: string): string {
  return estado === "cerrado"
    ? "bg-slate-100 text-slate-700 border-slate-300"
    : "bg-blue-100 text-blue-700 border-blue-300"
}

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

/** Badge classes for action-plan item estado. */
export function estadoPlanBadgeClass(estado: string): string {
  switch (estado) {
    case "cerrado":    return "bg-emerald-100 text-emerald-800 border-emerald-200"
    case "en_proceso": return "bg-amber-100 text-amber-800 border-amber-200"
    default:           return "bg-slate-100 text-slate-700 border-slate-200"
  }
}
