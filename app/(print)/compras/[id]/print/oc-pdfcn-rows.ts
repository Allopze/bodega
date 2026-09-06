/**
 * Aplana una OC en las filas que imprime la tabla de ítems.
 *
 * Es un módulo puro —sin JSX ni Takumi— por dos razones: se puede testear sin
 * levantar el motor wasm, y obliga a que el documento pdfcn use **las mismas**
 * funciones de formato que `page.tsx`. Si los dos motores calcularan sus
 * propios importes, tarde o temprano imprimirían números distintos para la
 * misma OC.
 */

import type { OcPrintData } from "./oc-print-data"
import {
  formatDecimal,
  formatDiscount,
  formatPlainCLP,
  formatPrintAmount,
  formatUnit,
} from "./oc-print-formatters"

// `type` y no `interface`: sólo los alias de tipo obtienen firma de índice
// implícita, y `DataTable` exige `T extends Record<string, unknown>`.
export type OcPdfRow = {
  n:         string
  sku:       string
  /** Nombre del producto; se dibuja destacado dentro de la celda Detalle. */
  nombre:    string
  /** Sub-líneas de la celda Detalle, en el mismo orden que la vista de impresión. */
  notas:     string[]
  cantidad:  string
  unidad:    string
  unitario:  string
  descuento: string
  total:     string
}

export function buildOcPdfRows(data: OcPrintData): OcPdfRow[] {
  return data.order.items.map((item, index) => {
    const product = item.productId ? data.productMap[item.productId] : null
    const equipment = item.requestItem?.equipment
    const worker    = item.requestItem?.worker
    const attributes = item.requestItem?.attributes.filter((attribute) =>
      attribute.attributeName.trim() && attribute.value.trim(),
    ) ?? []

    const notas: string[] = []
    if (equipment) {
      notas.push(
        `Equipo: ${equipment.code} · ${equipment.name}` +
        (equipment.serialNumber ? ` · N° serie ${equipment.serialNumber}` : ""),
      )
    }
    if (worker) notas.push(`Colaborador: ${worker.firstName} ${worker.lastName}`)
    for (const attribute of attributes) {
      notas.push(`${attribute.attributeName}: ${attribute.value}`)
    }
    if (item.notes) notas.push(item.notes)

    return {
      n:         String(index + 1).padStart(2, "0"),
      sku:       product?.sku ?? "",
      nombre:    product?.name ?? item.productNameFree ?? "Producto sin nombre",
      notas,
      cantidad:  formatDecimal(item.quantity),
      unidad:    formatUnit(item.unitOfMeasure),
      unitario:  formatPrintAmount(item.unitPrice, formatDecimal),
      descuento: formatDiscount(item.discount),
      total:     formatPrintAmount(item.subtotal, formatPlainCLP),
    }
  })
}

/**
 * Líneas sin precio. No suman al neto, así que el documento tiene que decirlo o
 * el proveedor lee un total que no incluye lo que todavía no está cotizado.
 */
export function countPendingCostLines(data: OcPrintData): number {
  return data.order.items.filter((item) => item.unitPrice === null).length
}

export function pendingCostNotice(pendingCostLines: number): string | null {
  if (pendingCostLines <= 0) return null
  return pendingCostLines === 1
    ? "1 servicio con costo por definir, no incluido en los totales."
    : `${pendingCostLines} servicios con costo por definir, no incluidos en los totales.`
}
