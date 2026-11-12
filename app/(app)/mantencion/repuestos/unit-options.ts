import { PRODUCT_UNITS } from "@/lib/products/units"

export interface SparePartUnit {
  code: string
  label: string
  isActive: boolean
}

/**
 * Las unidades de medida de la plataforma (`PRODUCT_UNITS`), en su orden. Todas
 * son elegibles; un repuesto con un código histórico fuera de la lista se
 * muestra con el código tal cual.
 */
export async function loadSparePartUnits(): Promise<SparePartUnit[]> {
  return PRODUCT_UNITS.map((unit) => ({ code: unit.code, label: unit.label, isActive: true }))
}
