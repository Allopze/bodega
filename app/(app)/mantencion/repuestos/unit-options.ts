import { asc } from "drizzle-orm"
import { db } from "@/db"
import { productUnits } from "@/db/schema"

export interface SparePartUnit {
  code: string
  label: string
  isActive: boolean
}

/**
 * Catálogo de unidades de medida (`product_units`), activas primero por orden. El formulario ofrece sólo las
 * activas —el servicio rechaza una desactivada— y la ficha usa todas para nombrar la unidad ya guardada.
 */
export async function loadSparePartUnits(): Promise<SparePartUnit[]> {
  const rows = await db
    .select({ code: productUnits.code, label: productUnits.label, isActive: productUnits.isActive })
    .from(productUnits)
    .orderBy(asc(productUnits.sortOrder), asc(productUnits.code))
  return rows
}
