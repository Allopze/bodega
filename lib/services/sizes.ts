/**
 * Lectura y sincronización del catálogo de tallas (`size_catalog`).
 *
 * La tabla existía con familia, código, orden y activo/inactivo, y su único
 * lector —`getCanonicalSizesByFamily`— no tenía ningún consumidor: las tallas
 * reales salían de una constante del cliente. Este servicio la pone a trabajar.
 *
 * Dar de baja una talla es `is_active = false`, nunca un DELETE: las variantes
 * y el histórico que la usan siguen existiendo.
 */
import { db } from "@/db"
import { sizeCatalog } from "@/db/schema/sizes"
import { SIZE_FAMILIES, sizeCatalogRows } from "@/lib/products/size-catalog"
import { compareSizeLabels } from "@/lib/products/product-size"
import { nanoid } from "@/lib/id"
import { eq, and, asc } from "drizzle-orm"

export interface SizeChoice {
  code: string
  displayOrder: number
}

export interface SizeFamilyOptions {
  family: string
  attributeName: string
  codes: string[]
}

/** Tallas activas de una familia, en orden de presentación. */
export async function getCanonicalSizesByFamily(family: string): Promise<string[]> {
  const rows = await db
    .select({ code: sizeCatalog.code })
    .from(sizeCatalog)
    .where(and(eq(sizeCatalog.family, family), eq(sizeCatalog.isActive, true)))
    .orderBy(asc(sizeCatalog.displayOrder))

  return rows.map((row) => row.code)
}

/**
 * Todas las familias con sus tallas activas, para el asistente de variantes.
 *
 * Si la tabla está vacía —base recién migrada, o sin correr el seed— devuelve la
 * semilla en vez de dejar el asistente sin presets: quedarse sin poder crear una
 * variante por talla es peor que usar los valores por defecto.
 */
export async function getSizeFamilyOptions(): Promise<SizeFamilyOptions[]> {
  const rows = await db
    .select({
      family: sizeCatalog.family,
      code: sizeCatalog.code,
      displayOrder: sizeCatalog.displayOrder,
    })
    .from(sizeCatalog)
    .where(eq(sizeCatalog.isActive, true))
    .orderBy(asc(sizeCatalog.family), asc(sizeCatalog.displayOrder))

  const byFamily = new Map<string, string[]>()
  for (const row of rows) {
    const bucket = byFamily.get(row.family)
    if (bucket) bucket.push(row.code)
    else byFamily.set(row.family, [row.code])
  }

  return SIZE_FAMILIES.map((definition) => ({
    family: definition.family,
    attributeName: definition.attributeName,
    codes: byFamily.get(definition.family) ?? [...definition.codes].sort(compareSizeLabels),
  }))
}

/**
 * Deja `size_catalog` al día con la semilla. Idempotente y no destructivo:
 * agrega lo que falta y no toca `is_active` ni el orden de lo que ya está —una
 * talla dada de baja a mano no revive en el próximo despliegue.
 */
export async function syncSizeCatalog(): Promise<{ created: number; existing: number }> {
  const desired = sizeCatalogRows()
  const existing = await db
    .select({ family: sizeCatalog.family, code: sizeCatalog.code })
    .from(sizeCatalog)

  const present = new Set(existing.map((row) => `${row.family}:${row.code}`))
  const missing = desired.filter((row) => !present.has(`${row.family}:${row.code}`))
  if (missing.length === 0) return { created: 0, existing: present.size }

  await db.insert(sizeCatalog).values(
    missing.map((row) => ({
      id: nanoid(),
      family: row.family,
      code: row.code,
      displayOrder: row.displayOrder,
      isActive: true,
    })),
  ).onConflictDoNothing()

  return { created: missing.length, existing: present.size }
}
