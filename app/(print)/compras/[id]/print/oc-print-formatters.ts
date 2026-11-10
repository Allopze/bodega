/**
 * Formatting helpers for the Orden de Compra print view.
 */

import { vehicleLabel } from "@/lib/fleet-vehicle-label"
import { requestItemAssetLabel } from "@/lib/purchasing/request-item-asset"

export function formatOrderNumber(code: string): string {
  return code.replace(/^OC-/, "")
}

export function formatRequestReference(code: string): string {
  const match = code.match(/^SOL-(?:\d{4}-)?(\d+)$/)
  if (!match) return code.replace(/^SOL-/, "")
  return String(Number(match[1])).padStart(2, "0")
}

const PLAIN_CLP_FORMAT = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const DECIMAL_FORMAT = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPlainCLP(amount: number): string {
  return PLAIN_CLP_FORMAT.format(amount)
}

export function formatDecimal(value: number): string {
  return DECIMAL_FORMAT.format(value)
}

/**
 * Importe de una línea impresa. `null` es costo pendiente —el servicio todavía
 * no tiene precio— y en un documento que va al proveedor eso se dice
 * "Por definir", nunca "0": un 0 impreso es un compromiso de que no se cobra.
 */
export const PENDING_COST_PRINT = "Por definir"

export function formatPrintAmount(
  value: number | null,
  format: (amount: number) => string,
): string {
  return value === null ? PENDING_COST_PRINT : format(value)
}

export function formatDiscount(discount?: number | null): string {
  if (!discount || discount <= 0) return ""
  return `${formatPlainCLP(discount)}%`
}

export function formatUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase()
  if (["unidad", "unidades", "un", "u"].includes(normalized)) return "UN"
  return unit.trim().toUpperCase()
}

/**
 * «Equipo: …» bajo la línea de la OC impresa: el instrumento de un servicio (con su N° de
 * serie, que el proveedor necesita para identificarlo) o el equipo de flota de un repuesto
 * con la OT de mantención que lo originó («Equipo: KA-54 · UD-1187 · OT OT-PAC-0006»), igual
 * que la ficha de la OC (`requestItemAssetLabel`). Lo usan la vista de impresión y el PDF.
 */
export function formatItemAssetNote(requestItem: {
  equipment?: { code: string; name: string; serialNumber?: string | null } | null
  vehicle?: { plate: string; code: string | null } | null
  workOrder?: { folio: string } | null
} | null | undefined): string | null {
  if (!requestItem) return null
  const { equipment, vehicle, workOrder } = requestItem
  const label = requestItemAssetLabel({
    equipmentLabel: equipment
      ? `${equipment.code} · ${equipment.name}${equipment.serialNumber ? ` · N° serie ${equipment.serialNumber}` : ""}`
      : null,
    vehicleLabel: vehicle ? vehicleLabel(vehicle) : null,
    workOrderFolio: workOrder?.folio ?? null,
  })
  return label ? `Equipo: ${label}` : null
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
