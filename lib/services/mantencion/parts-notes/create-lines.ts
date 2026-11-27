import { inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { costCenters, fuelVehicles, products, suppliers } from "@/db/schema"
import { toCents } from "@/lib/services/stock-reservations"

/**
 * Líneas de una nota de pedido (NP) antes de escribir nada (ADR 0001, 2026-11-27): cantidades, repuestos del catálogo,
 * y el cargo y el proveedor de cada línea. Lo comparten el alta desde el teléfono (`create.ts`) y la web (`create-manual.ts`),
 * para que las dos vías apliquen exactamente las mismas reglas.
 *
 * Cargo: un equipo (debe estar hoy en la faena de la NP) o un centro de costo (de esa faena), o nada. No los dos.
 * Proveedor sugerido: un proveedor del catálogo activo. El texto libre (`supplierHint`) no se valida.
 */

export interface NoteLineInput {
  description: string
  quantity: number
  unitOfMeasure?: string
  partNumber?: string | null
  productId?: string | null
  chargeVehicleId?: string | null
  chargeCostCenterId?: string | null
  suggestedSupplierId?: string | null
  supplierHint?: string | null
}

export interface LineIssue {
  message: string
  field: string
}

const unique = (values: ReadonlyArray<string | null | undefined>): string[] => [...new Set(values.filter((value): value is string => !!value))]

/** El primer problema de las líneas, o `null` si todas valen. `worksiteId` es la faena de la NP. */
export async function findLineIssueTx(tx: Tx, lines: readonly NoteLineInput[], worksiteId: string): Promise<LineIssue | null> {
  for (const [index, line] of lines.entries()) {
    if (toCents(line.quantity) <= 0) return { message: `La cantidad de «${line.description}» debe ser mayor que cero.`, field: `lines.${index}.quantity` }
    if (line.chargeVehicleId && line.chargeCostCenterId) {
      return { message: `«${line.description}» se imputa a un equipo o a un centro de costo, no a los dos.`, field: `lines.${index}.chargeVehicleId` }
    }
  }

  const productIds = unique(lines.map((line) => line.productId))
  if (productIds.length) {
    const rows = await tx.select({ id: products.id, isSparePart: products.isSparePart, isActive: products.isActive }).from(products).where(inArray(products.id, productIds))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const [index, line] of lines.entries()) {
      if (!line.productId) continue
      const product = byId.get(line.productId)
      if (!product || !product.isSparePart || !product.isActive) {
        return { message: `«${line.description}» ya no está en el catálogo de repuestos.`, field: `lines.${index}.productId` }
      }
    }
  }

  const vehicleIds = unique(lines.map((line) => line.chargeVehicleId))
  if (vehicleIds.length) {
    const rows = await tx.select({ id: fuelVehicles.id, worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive }).from(fuelVehicles).where(inArray(fuelVehicles.id, vehicleIds))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const [index, line] of lines.entries()) {
      if (!line.chargeVehicleId) continue
      const vehicle = byId.get(line.chargeVehicleId)
      if (!vehicle || !vehicle.isActive) return { message: `El equipo de cargo de «${line.description}» no existe o está dado de baja.`, field: `lines.${index}.chargeVehicleId` }
      if (vehicle.worksiteId !== worksiteId) return { message: `El equipo de cargo de «${line.description}» no está hoy en la faena de la nota.`, field: `lines.${index}.chargeVehicleId` }
    }
  }

  const costCenterIds = unique(lines.map((line) => line.chargeCostCenterId))
  if (costCenterIds.length) {
    const rows = await tx.select({ id: costCenters.id, worksiteId: costCenters.worksiteId, isActive: costCenters.isActive }).from(costCenters).where(inArray(costCenters.id, costCenterIds))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const [index, line] of lines.entries()) {
      if (!line.chargeCostCenterId) continue
      const center = byId.get(line.chargeCostCenterId)
      if (!center || !center.isActive) return { message: `El centro de costo de «${line.description}» no existe o está inactivo.`, field: `lines.${index}.chargeCostCenterId` }
      if (center.worksiteId !== worksiteId) return { message: `El centro de costo de «${line.description}» no es de la faena de la nota.`, field: `lines.${index}.chargeCostCenterId` }
    }
  }

  const supplierIds = unique(lines.map((line) => line.suggestedSupplierId))
  if (supplierIds.length) {
    const rows = await tx.select({ id: suppliers.id, isActive: suppliers.isActive }).from(suppliers).where(inArray(suppliers.id, supplierIds))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const [index, line] of lines.entries()) {
      if (!line.suggestedSupplierId) continue
      const supplier = byId.get(line.suggestedSupplierId)
      if (!supplier || !supplier.isActive) return { message: `El proveedor sugerido de «${line.description}» no existe o está inactivo.`, field: `lines.${index}.suggestedSupplierId` }
    }
  }
  return null
}
