import { and, eq, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelSuppliers } from "@/db/schema"
import { logger } from "@/lib/logger"

/**
 * Fuentes automáticas y etiquetas históricas para el guard de importación Copec.
 * Las etiquetas de Aramco sólo reconocen lotes que aún no se hayan limpiado:
 * sin esta exclusión, un lote antiguo bloquearía la sincronización de Copec.
 * No habilitan importación ni sincronización del proveedor retirado.
 */

/** Fuente por producto. Única definición: `copec-sync` construía la etiqueta con
 *  un template aparte, así que editar sólo uno de los dos desalineaba el dedup
 *  (que compara la fuente exacta) del guard (que compara contra la lista). */
const COPEC_TCT_SOURCE_BY_PRODUCT = {
  diesel: "Copec TCT Diesel",
  bluemax: "Copec TCT BlueMax",
} as const

export type CopecTctProduct = keyof typeof COPEC_TCT_SOURCE_BY_PRODUCT

export const COPEC_TCT_SOURCES: string[] = Object.values(COPEC_TCT_SOURCE_BY_PRODUCT)

export function copecTctSource(product: CopecTctProduct): string {
  return COPEC_TCT_SOURCE_BY_PRODUCT[product]
}

export const ARAMCO_SOURCES = [
  "Aramco Fleet Diesel",
  "Aramco Fleet AdBlue",
  "Aramco Fleet Gasolina",
  "Aramco Fleet Kerosene",
  "Aramco Fleet Otros",
]

/** Unión de las fuentes de todos los proveedores automáticos. Lo que NO está acá
 *  se considera carga manual y sí debe bloquear una sincronización. */
export const AUTOMATED_SOURCES = [...COPEC_TCT_SOURCES, ...ARAMCO_SOURCES]

/** Nombres del proveedor en el catálogo de combustible. */
const SUPPLIER_NAME_ALIASES: Record<"copec", string[]> = {
  copec: ["copec"],
}

/**
 * Id del proveedor en `fuel_suppliers` para una integración automática.
 *
 * `fuel_suppliers` es catálogo del usuario, no una constante del código: la base
 * real trae los proveedores que creó operación (`seed-copec`, `seed-enex`), no
 * los `fs-copec` que sembraba `db/seed-combustibles.ts` —un script
 * que no está enganchado a ningún `db:seed`—. Hardcodear el id hacía que cada
 * fila de la corrida reventara con violación de FK.
 *
 * Se resuelve por nombre porque es lo único que liga la integración con la fila
 * del catálogo. Devuelve null si el proveedor todavía no existe: la transacción
 * queda sin proveedor (la columna es nullable) y la conciliación no la cruza con
 * nada, en vez de perder la corrida entera. Al crearlo, la corrida siguiente ya
 * lo toma sin tocar código — pero ahora deja rastro en el log, porque hasta acá
 * el caso era indistinguible de "todo conciliado".
 *
 * El desempate va por `name` y no por `id`: los ids son opacos, así que con dos
 * fichas candidatas el ganador era arbitrario y podía cambiar entre corridas.
 */
export async function fuelSupplierIdForProvider(provider: "copec"): Promise<string | null> {
  const aliases = SUPPLIER_NAME_ALIASES[provider]
  const [row] = await db.select({ id: fuelSuppliers.id })
    .from(fuelSuppliers)
    .where(and(
      eq(fuelSuppliers.isActive, true),
      or(...aliases.map((alias) => sql`lower(${fuelSuppliers.name}) LIKE ${`%${alias}%`}`)),
    ))
    .orderBy(fuelSuppliers.name, fuelSuppliers.id)
    .limit(1)
  if (!row) {
    logger.warn("[combustibles/fuel-sources] sin ficha en fuel_suppliers para la integración: la conciliación no podrá cruzar sus transacciones", {
      provider,
      aliases,
    })
    return null
  }
  return row.id
}
