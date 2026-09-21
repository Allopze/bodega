/**
 * Etiquetas de los enums del denominador, en un solo lugar.
 *
 * Antes vivían duplicadas: el `Select` del diálogo decía "Cuadra con la fuente"
 * y la tabla del tablero decía "Conciliado" para el MISMO valor `matched`. Peor,
 * el mapa del tablero tenía la clave `submitted`, que no existe —el servicio
 * escribe `pending_review` (y el CHECK de la tabla sólo admite
 * draft/pending_review/approved/rejected)—, así que un denominador enviado a
 * revisión se pintaba con el enum crudo `pending_review`, justo lo que prohíbe
 * la regla A6. Que era un typo y no un diseño lo delataba `statusVariant`, que
 * sí contemplaba `pending_review` y le daba el color correcto al texto crudo.
 */

export const DENOMINATOR_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  pending_review: "En revisión",
  approved: "Aprobado",
  rejected: "Rechazado",
}

export const RECONCILIATION_LABELS: Record<string, string> = {
  pending: "Pendiente",
  matched: "Cuadra con la fuente",
  difference: "Con diferencia explicada",
  exception: "Excepción aceptada",
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  rrhh: "RR.HH.",
  xlsx_import: "Importación Excel",
  manual: "Carga manual controlada",
  other_system: "Otro sistema",
}

export function labelOrRaw(catalog: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—"
  return catalog[value] ?? value
}

export function denominatorStatusVariant(status: string | null | undefined): "success" | "warning" | "danger" | "default" {
  if (status === "approved") return "success"
  if (status === "rejected") return "danger"
  if (status === "pending_review") return "warning"
  return "default"
}
