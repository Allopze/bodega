import { and, eq, inArray, sql } from "drizzle-orm"
import type { DB } from "@/db"
import { dispatchGuideItems, dispatchGuides } from "@/db/schema"

/**
 * `GDI-002` (auditoría 2026-09-14): el traslado interno mueve el stock **al
 * despachar**, no al cotejar. Entre una cosa y la otra la mercadería viaja en
 * un camión pero contablemente ya está en la faena: aparece en `worksite_stock`,
 * suma en la disponibilidad y es entregable a un trabajador antes de haber
 * llegado. El sistema no lo impedía; lo detectaba DESPUÉS, con el caso
 * `DELIVERY_BEFORE_FAENA_RECEIPT` de trazabilidad.
 *
 * QUEDA POR DECIDIR (producto, no código): la corrección de fondo es una
 * ubicación de tránsito —que lo despachado no entre a la faena hasta el
 * cotejo—. Eso es un cambio de modelo de datos y una decisión de negocio (¿de
 * quién es el stock mientras viaja?, ¿qué pasa con un faltante de cotejo?, ¿qué
 * ve la faena en su saldo?), y no se inventa aquí.
 *
 * Lo que sí se puede hacer sin esa decisión es esto: saber CUÁNTO de lo que
 * figura en la faena todavía viaja, y decirlo donde se decide entregar.
 */

/** Guías cuyo contenido ya salió de oficina y aún no está cotejado por completo. */
const IN_TRANSIT_GUIDE_STATUSES = ["dispatched", "partially_received"] as const

export type DispatchInTransitReader = Pick<DB, "select">

/**
 * Cuánto de cada producto viaja hacia esta faena: lo despachado menos lo ya
 * cotejado, por guía. Una guía `received` no aporta nada y una `draft` tampoco
 * (todavía no movió stock). Devuelve sólo los productos con saldo en tránsito.
 */
export async function readInTransitToWorksite(
  reader: DispatchInTransitReader,
  worksiteId: string,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()
  const rows = await reader
    .select({
      productId: dispatchGuideItems.productId,
      inTransit: sql<number>`coalesce(sum(${dispatchGuideItems.quantity} - coalesce(${dispatchGuideItems.quantityReceived}, 0)), 0)`,
    })
    .from(dispatchGuideItems)
    .innerJoin(dispatchGuides, eq(dispatchGuides.id, dispatchGuideItems.guideId))
    .where(and(
      eq(dispatchGuides.destinationWorksiteId, worksiteId),
      inArray(dispatchGuides.status, [...IN_TRANSIT_GUIDE_STATUSES]),
      inArray(dispatchGuideItems.productId, [...productIds]),
    ))
    .groupBy(dispatchGuideItems.productId)

  const byProduct = new Map<string, number>()
  for (const row of rows) {
    const quantity = Number(row.inTransit ?? 0)
    // Un cotejo puede recibir de más sólo por redondeo del `real`; nunca resta.
    if (quantity > 0) byProduct.set(row.productId, quantity)
  }
  return byProduct
}

/**
 * Lo que la faena tiene de verdad a mano: el saldo contable menos lo que viaja.
 * Puede dar cero aunque `worksite_stock` diga otra cosa — ese es justamente el
 * punto del hallazgo.
 */
export function deliverableQuantity(onHand: number, inTransit: number): number {
  return Math.max(0, onHand - Math.max(0, inTransit))
}

export interface InTransitDeliveryLine {
  productName: string
  quantity: number
  onHand: number
  inTransit: number
}

/**
 * El aviso, o null si nada de lo entregado depende de mercadería en tránsito.
 *
 * DECISIÓN: **advierte, no bloquea.** Bloquear sería tratar el saldo en tránsito
 * como inexistente, y no lo es: el caso más frecuente en terreno es que la
 * mercadería YA LLEGÓ y lo que falta es el cotejo en la plataforma, que ocurre
 * horas o días después. Bloquear ahí impediría una entrega legítima —y con EPP
 * de por medio, empujaría a entregar sin registrar, que es peor que registrar
 * con un saldo optimista—. Avisar con la cifra concreta le da a quien entrega
 * lo único que le faltaba: saber que ese saldo puede no estar en la bodega, y
 * que hay un cotejo pendiente que cerrar.
 */
export function inTransitDeliveryWarning(lines: readonly InTransitDeliveryLine[]): string | null {
  const afectadas = lines.filter((line) => line.inTransit > 0 && line.quantity > deliverableQuantity(line.onHand, line.inTransit))
  if (afectadas.length === 0) return null
  const detalle = afectadas
    .map((line) => `${line.productName}: ${formatQuantity(line.inTransit)} en tránsito de ${formatQuantity(line.onHand)} en saldo`)
    .join("; ")
  return `Atención: parte de lo entregado figura en la faena pero todavía viaja en una guía de despacho sin cotejar (${detalle}). `
    + "Si la mercadería ya llegó, cierra el cotejo de la guía; si no, verifica físicamente antes de entregar."
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
