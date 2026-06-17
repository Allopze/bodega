/**
 * Central source of truth for request type metadata.
 * Used in request-form, request-list, and approval-panel.
 */

export const REQUEST_TYPE_OPTS = [
  { value: "epp",       label: "EPP" },
  { value: "repuestos", label: "Repuestos" },
  { value: "servicios", label: "Servicios" },
  { value: "otro",      label: "Otros" },
] as const

/** Includes legacy types (stock, mantencion) for display in existing records */
export const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp:        "EPP",
  repuestos:  "Repuestos",
  servicios:  "Servicios",
  otro:       "Otros",
  stock:      "Stock",       // legacy
  mantencion: "Mantención",  // legacy
}

export const REQUEST_TYPE_VARIANTS: Record<string, "info" | "success" | "warning" | "default"> = {
  epp:        "info",
  repuestos:  "warning",
  servicios:  "info",
  otro:       "default",
  stock:      "success",       // legacy
  mantencion: "warning",       // legacy
}

/**
 * Types that use the quotation-based approval flow (PDF cotizaciones).
 * EPP and "otro" use the per-item approval flow.
 */
export const QUOTATION_TYPES = new Set(["repuestos", "servicios"])
