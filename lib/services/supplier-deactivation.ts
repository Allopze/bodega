/**
 * Qué queda vivo cuando se da de baja un proveedor.
 *
 * `PRV-001` (auditoría 2026-09-14), instancia del patrón P2. Desactivar era un
 * `UPDATE is_active = false` con auditoría y nada más: no miraba si el
 * proveedor tenía órdenes en borrador, órdenes enviadas pendientes de recepción
 * o facturas sin conciliar.
 *
 * Importa porque es la mitad ascendente de `OC-001`: la emisión de una OC no
 * revalida el estado del proveedor, así que una orden en borrador cuyo
 * proveedor se acaba de desactivar **igual se puede emitir** —y aguas abajo el
 * proveedor ya no aparece en ningún selector, de modo que la OC queda
 * apuntando a alguien que la interfaz no ofrece—.
 *
 * A diferencia del catálogo, aquí **no se bloquea**. Dejar de trabajar con un
 * proveedor es un hecho comercial que puede ocurrir con órdenes abiertas, y
 * exigir cerrarlas todas antes obligaría a mantener activo a quien ya no lo
 * está. El criterio es el mismo que en la baja de una persona: mirar, decirlo
 * y dejarlo escrito en la auditoría.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { purchaseOrderInvoices, purchaseOrders, suppliers } from "@/db/schema"
import { invoiceNotVoided } from "@/lib/services/purchasing-module/invoice-scope"

export type SupplierDependencyKind = "draft_orders" | "open_orders" | "unreconciled_invoices"

export interface SupplierDependency {
  kind: SupplierDependencyKind
  count: number
  label: string
  /** Códigos de OC concretos, acotados. */
  samples: string[]
}

export interface SupplierDependencySummary {
  supplierId: string
  items: SupplierDependency[]
  clear: boolean
}

/**
 * Una orden emitida y todavía sin recibir del todo. `closed` y `cancelled`
 * quedan fuera: ya no esperan nada del proveedor.
 */
export const OPEN_ORDER_STATUSES = [
  "sent",
  "partially_office_received",
  "office_received",
  "partially_received",
] as const

const SAMPLE_LIMIT = 5

function toDependency(
  kind: SupplierDependencyKind,
  codes: string[],
  singular: string,
  plural: string,
): SupplierDependency | null {
  if (codes.length === 0) return null
  return {
    kind,
    count: codes.length,
    label: codes.length === 1 ? singular : `${codes.length} ${plural}`,
    samples: codes.slice(0, SAMPLE_LIMIT),
  }
}

export async function getSupplierDependencies(
  supplierId: string,
  client: typeof db | Tx = db,
): Promise<SupplierDependencySummary> {
  const [drafts, open, invoices] = await Promise.all([
    client.select({ code: purchaseOrders.code }).from(purchaseOrders).where(and(
      eq(purchaseOrders.supplierId, supplierId),
      eq(purchaseOrders.status, "draft"),
    )),

    client.select({ code: purchaseOrders.code }).from(purchaseOrders).where(and(
      eq(purchaseOrders.supplierId, supplierId),
      inArray(purchaseOrders.status, [...OPEN_ORDER_STATUSES]),
    )),

    // Facturas colgadas de una OC del proveedor cuya conciliación no se resolvió.
    client.select({ code: purchaseOrders.code })
      .from(purchaseOrderInvoices)
      .innerJoin(purchaseOrders, eq(purchaseOrderInvoices.purchaseOrderId, purchaseOrders.id))
      .where(and(
        eq(purchaseOrders.supplierId, supplierId),
        // `matched` y `accepted_exception` son las dos formas de estar
        // resuelto: la segunda es una diferencia que alguien revisó y aceptó.
        sql`${purchaseOrders.invoiceReconciliationStatus} NOT IN ('matched', 'accepted_exception')`,
        invoiceNotVoided,
      )),
  ])

  const codes = (rows: { code: string | null }[]) =>
    [...new Set(rows.flatMap((row) => (row.code ? [row.code] : [])))]

  const items = [
    toDependency("draft_orders", codes(drafts), "1 orden en borrador", "órdenes en borrador"),
    toDependency("open_orders", codes(open), "1 orden emitida sin recibir del todo", "órdenes emitidas sin recibir del todo"),
    toDependency("unreconciled_invoices", codes(invoices), "1 orden con factura sin conciliar", "órdenes con factura sin conciliar"),
  ].filter((entry): entry is SupplierDependency => entry !== null)

  return { supplierId, items, clear: items.length === 0 }
}

export function describeSupplierDependencies(summary: SupplierDependencySummary): string {
  if (summary.clear) return "No quedan órdenes ni facturas abiertas con este proveedor."
  return summary.items.map((entry) => entry.label).join("; ")
}

/**
 * `PRV-002`: ¿hay algo emitido a nombre de este proveedor? Una orden de compra
 * o un documento tributario colgado de ella bastan; el criterio no es que la
 * relación esté abierta sino que exista historia que el RUT explique.
 */
export async function supplierHasDocuments(
  supplierId: string,
  client: typeof db | Tx = db,
): Promise<boolean> {
  const [row] = await client.select({
    used: sql<boolean>`
      exists(select 1 from ${purchaseOrders} where ${purchaseOrders.supplierId} = ${supplierId})
      or exists(
        select 1 from ${purchaseOrderInvoices}
        join ${purchaseOrders} po on po.id = ${purchaseOrderInvoices.purchaseOrderId}
        where po.supplier_id = ${supplierId}
      )
    `,
  }).from(suppliers).where(eq(suppliers.id, supplierId))
  return Boolean(row?.used)
}
