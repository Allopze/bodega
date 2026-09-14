/**
 * El recorte de Solicitudes, en un solo sitio.
 *
 * `REQ-003` (auditoría 2026-09-14), instancia del patrón P8 —«la exportación no
 * reproduce lo que la pantalla muestra»—. El predicado de la lista y el del
 * exportador habían evolucionado por separado y ni siquiera compartían los
 * nombres de sus parámetros (`estado`/`status`, `desde`/`from`, `hasta`/`to`).
 * El resultado:
 *
 *  - la pestaña «En aprobación» agrupa dos estados y los serializaba como
 *    `"submitted,in_review"`, que el exportador comparaba con `=`: una igualdad
 *    imposible, y el Excel salía **vacío** con la lista llena;
 *  - el período no viajaba en el enlace, así que se exportaba todo el histórico;
 *  - la búsqueda por nombre de producto no se reproducía —la lista mira el
 *    nombre libre y el del catálogo con un `EXISTS`, el exportador sólo el
 *    código de la solicitud—.
 *
 * Las tres se arreglan con lo mismo: que las dos consultas compongan el
 * predicado con estas funciones en vez de escribirlo cada una.
 */

import { ilike, or, sql, type SQL } from "drizzle-orm"
import { purchaseRequests } from "@/db/schema"
import { escapeLikePattern } from "@/lib/utils"

/**
 * Código de la solicitud **o** nombre de alguno de sus productos, libre o de
 * catálogo. `EXISTS` en vez de `JOIN` para no duplicar filas cuando varios
 * ítems calzan con el texto.
 */
export function solicitudesSearchSql(q: string): SQL | undefined {
  const term = q.trim()
  if (!term) return undefined
  const pattern = `%${escapeLikePattern(term)}%`
  return or(
    ilike(purchaseRequests.code, pattern),
    sql`EXISTS (
      SELECT 1 FROM purchase_request_items pri
      LEFT JOIN products p ON p.id = pri.product_id
      WHERE pri.request_id = ${purchaseRequests.id}
        AND (
          pri.product_name_free ILIKE ${pattern}
          OR p.name ILIKE ${pattern}
        )
    )`,
  )
}

/**
 * Los estados tal como los serializa la barra de pestañas: una lista separada
 * por coma. Devolver un arreglo —y no una cadena— es justamente lo que evita
 * que el exportador vuelva a compararla con `=`.
 */
export function parseEstadosParam(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(",").map((value) => value.trim()).filter(Boolean)
}
