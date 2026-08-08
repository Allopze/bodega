/**
 * Diccionarios de etiquetas para los enums del módulo combustibles, en un solo
 * lugar sin `"use client"` para que tanto componentes de UI como server
 * actions (exportaciones XLSX) puedan importarlos.
 *
 * Antes había 3 copias de las etiquetas de estado TAE (tae/page.tsx,
 * tae/[id]/page.tsx, tae/[id]/review-controls.tsx) con una discrepancia real:
 * review-controls.tsx decía `submitted: "Enviada"` mientras las otras dos —y
 * el filtro de la lista— dicen "Recibida". Colapsarlas aquí la resuelve de
 * paso.
 */

export type BadgeVariant = "primary" | "default" | "info" | "warning" | "success" | "signal" | "danger" | "outline"

export const FUEL_LOAD_STATUS_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  draft:      { label: "Borrador",   variant: "default" },
  registered: { label: "Registrado", variant: "primary" },
  reconciled: { label: "Conciliado", variant: "outline" },
  cancelled:  { label: "Anulado",    variant: "danger" },
}

export const FUEL_STATEMENT_STATUS_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  open:     { label: "Abierto",      variant: "default" },
  partial:  { label: "Pago parcial", variant: "outline" },
  paid:     { label: "Pagado",       variant: "success" },
  overdue:  { label: "Vencido",      variant: "danger" },
  cancelled: { label: "Anulado",     variant: "danger" },
}

/** "Recibida" es el canónico — es el que usa el filtro de /combustibles/tae. */
export const TAE_STATUS_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  submitted: { label: "Recibida",  variant: "primary" },
  observed:  { label: "Observada", variant: "warning" },
  validated: { label: "Validada",  variant: "success" },
  voided:    { label: "Anulada",   variant: "danger" },
}

/** No existía ningún diccionario para esto — la fuente de la lectura de
 *  medidor salía cruda ("ocr"/"manual"/"import") en la exportación XLSX. */
export const TAE_METER_SOURCE_LABELS: Record<string, string> = {
  ocr: "OCR",
  manual: "Manual",
  import: "Importación",
}

export function fuelLoadStatusLabel(status: string): string {
  return FUEL_LOAD_STATUS_LABELS[status]?.label ?? status
}

export function fuelStatementStatusLabel(status: string): string {
  return FUEL_STATEMENT_STATUS_LABELS[status]?.label ?? status
}

export function taeStatusLabel(status: string): string {
  return TAE_STATUS_LABELS[status]?.label ?? status
}

export function taeMeterSourceLabel(source: string | null): string {
  if (!source) return ""
  return TAE_METER_SOURCE_LABELS[source] ?? source
}
