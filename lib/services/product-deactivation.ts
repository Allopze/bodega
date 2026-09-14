/**
 * Qué queda vivo cuando se da de baja un producto del catálogo.
 *
 * `CAT-001` (auditoría 2026-09-14), instancia del patrón P2. Desactivar un
 * producto era un `UPDATE is_active = false`, individual o en lotes de cien.
 * Después de eso la entrega lo rechaza («Producto no disponible»), la guía de
 * despacho no lo ofrece y el selector de solicitudes lo filtra —pero el saldo
 * sigue en `worksite_stock`, contando en el kardex y en la valorización—. El
 * resultado es inventario real que no se puede mover y que sólo vuelve a la
 * vida si alguien recuerda reactivar el producto.
 *
 * La plataforma ya sabía tratarlo así en dos sitios: `setWorksiteActive` llama
 * a `assertWorksiteHasNoStock` y se niega a cerrar una faena con saldo, y el
 * backfill de variantes duplicadas sólo da de baja las que no tienen stock ni
 * referencias, con esta nota en su encabezado: «desactivar una variante con
 * stock esconde inventario real».
 *
 * Aquí se **informa y se bloquea**, no como en la baja de un trabajador —donde
 * la salida de la persona ya ocurrió y hay que poder registrarla—: un producto
 * con saldo no tiene ninguna urgencia de desaparecer del catálogo, y el
 * inventario escondido no avisa.
 */

import { and, gt, inArray, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { products, worksiteStock, worksites } from "@/db/schema"

export interface ProductStockBlocker {
  productId: string
  productName: string
  /** Saldo total sumado sobre las faenas donde queda algo. */
  quantity: number
  /** Nombres de faena, para que se sepa dónde está lo que no se puede esconder. */
  worksiteNames: string[]
}

/**
 * Los productos del lote que todavía tienen saldo. Una sola consulta para todo
 * el lote: la acción masiva admite cien ids y no puede pagar cien viajes.
 */
export async function productsWithStock(
  tx: Tx,
  productIds: readonly string[],
): Promise<ProductStockBlocker[]> {
  if (productIds.length === 0) return []

  const rows = await tx
    .select({
      productId: worksiteStock.productId,
      productName: products.name,
      quantity: sql<number>`sum(${worksiteStock.quantity})::float`,
      worksiteNames: sql<string[]>`array_agg(${worksites.name} order by ${worksites.name})`,
    })
    .from(worksiteStock)
    .innerJoin(products, sql`${products.id} = ${worksiteStock.productId}`)
    .innerJoin(worksites, sql`${worksites.id} = ${worksiteStock.worksiteId}`)
    .where(and(
      inArray(worksiteStock.productId, [...productIds]),
      gt(worksiteStock.quantity, 0),
    ))
    .groupBy(worksiteStock.productId, products.name)

  return rows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    quantity: Number(row.quantity ?? 0),
    worksiteNames: row.worksiteNames ?? [],
  }))
}

const MAX_NAMED = 3

/**
 * El mensaje de rechazo. Nombra hasta tres productos y sus faenas; más allá de
 * eso una lista completa deja de ayudar y sólo esconde la cifra.
 */
export function describeProductStockBlockers(blockers: readonly ProductStockBlocker[]): string {
  const detalle = blockers.slice(0, MAX_NAMED).map((blocker) =>
    `${blocker.productName} (${blocker.quantity} en ${blocker.worksiteNames.join(", ")})`)
  const resto = blockers.length - detalle.length
  const lista = resto > 0 ? `${detalle.join("; ")} y ${resto} más` : detalle.join("; ")

  return blockers.length === 1
    ? `No se puede desactivar: ${lista} todavía tiene saldo. Da de baja o traslada el inventario antes de sacarlo del catálogo.`
    : `No se pueden desactivar ${blockers.length} productos con saldo: ${lista}. Da de baja o traslada el inventario antes de sacarlos del catálogo.`
}
