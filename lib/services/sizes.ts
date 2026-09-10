/**
 * Lectura y sincronización del catálogo de tallas (`size_catalog`).
 *
 * La tabla existía con familia, código, orden y activo/inactivo pero sin
 * lectores reales: las tallas que ofrecía la aplicación salían de una constante
 * del cliente. `getSizeFamilyOptions` la pone a trabajar y es el único lector
 * que hay — un segundo lector «por familia» existió sin consumidor y se quitó,
 * porque toda pantalla que pide tallas pide todas las familias de una vez.
 *
 * Dar de baja una talla es `is_active = false`, nunca un DELETE: las variantes
 * y el histórico que la usan siguen existiendo.
 */
import { db } from "@/db"
import { sizeCatalog } from "@/db/schema/sizes"
import { SIZE_FAMILIES, sizeCatalogRows } from "@/lib/products/size-catalog"
import { compareSizeLabels } from "@/lib/products/product-size"
import { nanoid } from "@/lib/id"
import { eq, asc } from "drizzle-orm"

export interface SizeChoice {
  code: string
  displayOrder: number
}

export interface SizeFamilyOptions {
  family: string
  attributeName: string
  codes: string[]
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
 * agrega lo que falta y **no toca `is_active`** —una talla dada de baja a mano
 * no revive en el próximo despliegue.
 *
 * El `display_order` sí se recalcula, porque es un derivado del comparador y no
 * una opinión guardada (ver `lib/products/size-catalog.ts`). Insertar sólo lo
 * que falta no alcanza: la migración 0088 sembró `guantes` con S, M, L, XL en
 * los órdenes 0..3, y cuando la semilla agregó XS y 2XL el XS entraba con el
 * orden que le toca en la semilla (0), empataba con el S y la familia salía
 * «S, XS, M, L, XL» en el padrón. Se reordena la familia completa, incluidas
 * las tallas que alguien haya agregado a mano y no estén en la semilla.
 */
export async function syncSizeCatalog(): Promise<{
  created: number
  existing: number
  reordered: number
}> {
  const desired = sizeCatalogRows()
  const existing = await db
    .select({ family: sizeCatalog.family, code: sizeCatalog.code })
    .from(sizeCatalog)

  const present = new Set(existing.map((row) => `${row.family}:${row.code}`))
  const missing = desired.filter((row) => !present.has(`${row.family}:${row.code}`))

  if (missing.length > 0) {
    await db.insert(sizeCatalog).values(
      missing.map((row) => ({
        id: nanoid(),
        family: row.family,
        code: row.code,
        displayOrder: row.displayOrder,
        isActive: true,
      })),
    ).onConflictDoNothing()
  }

  const reordered = await reconcileDisplayOrder()
  return { created: missing.length, existing: present.size, reordered }
}

/**
 * Renumera `display_order` de cada familia según `compareSizeLabels`, dejándolo
 * consecutivo desde 0 y sin empates. Sólo escribe las filas cuyo orden cambia.
 */
async function reconcileDisplayOrder(): Promise<number> {
  const rows = await db
    .select({
      id: sizeCatalog.id,
      family: sizeCatalog.family,
      code: sizeCatalog.code,
      displayOrder: sizeCatalog.displayOrder,
    })
    .from(sizeCatalog)

  const byFamily = new Map<string, typeof rows>()
  for (const row of rows) {
    const bucket = byFamily.get(row.family)
    if (bucket) bucket.push(row)
    else byFamily.set(row.family, [row])
  }

  let reordered = 0
  for (const bucket of byFamily.values()) {
    const ordered = [...bucket].sort((left, right) => compareSizeLabels(left.code, right.code))
    for (const [index, row] of ordered.entries()) {
      if (row.displayOrder === index) continue
      await db.update(sizeCatalog).set({ displayOrder: index }).where(eq(sizeCatalog.id, row.id))
      reordered++
    }
  }

  return reordered
}
