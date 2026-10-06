import { and, eq, exists, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { deliveries, deliveryItems, products, workers } from "@/db/schema"
import { textSearchSql } from "@/lib/adquisiciones/list-query"

/** Tope de la consulta: un pegado accidental no debe armar un ILIKE enorme. */
export const DELIVERY_SEARCH_MAX_LENGTH = 100

/** Normaliza el `?q=` de la URL: sólo texto, recortado y acotado. */
export function readDeliverySearch(raw: string | string[] | undefined): string {
  const value = typeof raw === "string" ? raw : ""
  return value.trim().slice(0, DELIVERY_SEARCH_MAX_LENGTH)
}

/**
 * Búsqueda de servidor del historial de entregas (BOD-01, auditoría 2026-10-05).
 *
 * El input de la shell sólo filtraba las 25 filas de la página en pantalla, así
 * que un trabajador de la página 3 daba "Sin entregas". Esto filtra en SQL, antes
 * de contar y paginar.
 *
 * Cada palabra debe coincidir con alguno de: código de la entrega, quien recibe,
 * nombre o RUT del trabajador, o nombre de un producto entregado. Se separa por
 * palabras para que "Eduardo Pérez" encuentre a quien está guardado como
 * nombre "Eduardo" + apellido "Pérez", y el RUT se compara también sin puntos ni
 * guion ("12345678" encuentra "12.345.678-5").
 */
export function deliveryHistorySearchSql(q: string): SQL | undefined {
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return undefined

  const perToken = tokens.map((token) => {
    const direct = textSearchSql(token, [deliveries.code, deliveries.receiverName])
    const workerMatch = exists(
      db
        .select({ one: sql`1` })
        .from(workers)
        .where(and(
          eq(workers.id, deliveries.workerId),
          or(
            textSearchSql(token, [workers.firstName, workers.lastName, workers.rut]),
            // Mismo `escapeLike` de textSearchSql aplicado a la forma sin puntuación.
            textSearchSql(token.replace(/[.\-]/g, ""), [sql`replace(replace(${workers.rut}, '.', ''), '-', '')` as unknown as AnyColumn]),
          ),
        )),
    )
    const productMatch = exists(
      db
        .select({ one: sql`1` })
        .from(deliveryItems)
        .leftJoin(products, eq(deliveryItems.productId, products.id))
        .where(and(
          eq(deliveryItems.deliveryId, deliveries.id),
          textSearchSql(token, [products.name, deliveryItems.productNameFree]),
        )),
    )
    return or(direct, workerMatch, productMatch)
  })

  return and(...perToken)
}
