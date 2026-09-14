/**
 * `CAT-003` (auditoría 2026-09-14): el catálogo de unidades manda sobre el producto.
 *
 * `product_units` es un catálogo administrable —código, etiqueta, orden,
 * activo— y `products.unit_of_measure` era texto libre validado sólo por largo
 * (1 a 24, minúsculas). Nada comprobaba que la unidad guardada existiera en el
 * catálogo ni que siguiera activa, así que el catálogo era una sugerencia:
 * convivían unidades fuera de él y desactivar una no impedía seguir usándola.
 *
 * DOS MITADES, PORQUE SON DOS PROBLEMAS DISTINTOS:
 *
 *  1. **Existir** en el catálogo. Va en base, como FK (migración 0307). Una
 *     validación que sólo viviera en zod no alcanza a los importadores masivos
 *     (XLSX de productos, EPP) ni a los scripts, que escriben `products`
 *     directamente. La FK alcanza a todo camino de escritura.
 *  2. **Estar activa**. No lo puede expresar una FK —una unidad desactivada
 *     sigue existiendo, y tiene que seguir existiendo mientras haya productos
 *     que la usen—, así que se comprueba acá, al escribir.
 *
 * LO QUE ESTE MÓDULO NO DECIDE (queda pendiente de producto): qué pasa con los
 * productos que YA usan una unidad que el administrador desactiva. Hoy siguen
 * como están: la desactivación impide elegirla de nuevo, no reescribe el
 * catálogo de productos existente. Migrarlos a otra unidad cambia el
 * significado de cantidades históricas (stock, recepciones, entregas) y esa
 * conversión no está declarada en ninguna parte de la plataforma.
 */

import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { productUnits } from "@/db/schema"

/** Normaliza igual que `unitOfMeasureSchema`: sin espacios sobrantes, minúscula. */
export function normalizeUnitCode(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

/** Los códigos que hoy se pueden elegir. Una consulta por lote, no por fila. */
export async function loadActiveUnitCodes(client: typeof db | Tx = db): Promise<Set<string>> {
  const rows = await client
    .select({ code: productUnits.code })
    .from(productUnits)
    .where(eq(productUnits.isActive, true))
  return new Set(rows.map((row) => normalizeUnitCode(row.code)))
}

export function unitNotInCatalogMessage(unit: string): string {
  return `La unidad "${unit}" no existe en el catálogo de unidades o está desactivada. Agrégala en Administración → Catálogos de productos antes de usarla.`
}

/**
 * Valida una sola unidad contra el catálogo activo y devuelve su forma
 * normalizada. Lanza con un mensaje accionable si no corresponde.
 */
export async function resolveActiveUnitCode(
  unit: string,
  client: typeof db | Tx = db,
): Promise<string> {
  const normalized = normalizeUnitCode(unit)
  const active = await loadActiveUnitCodes(client)
  if (!active.has(normalized)) throw new Error(unitNotInCatalogMessage(unit))
  return normalized
}
