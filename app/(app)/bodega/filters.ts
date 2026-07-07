import { matchesQuery } from "@/lib/utils"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"

export function filterStockItems(items: WorksiteStockWithProduct[], query: string): WorksiteStockWithProduct[] {
  return items.filter((item) => matchesQuery(query, [item.product?.name, item.product?.sku]))
}

export function filterMovements(movements: InventoryMovementWithRelations[], query: string): InventoryMovementWithRelations[] {
  return movements.filter((m) => matchesQuery(query, [m.product?.name, m.worksite?.name, m.reason, m.notes]))
}
