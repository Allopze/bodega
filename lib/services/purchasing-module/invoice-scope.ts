/**
 * Qué facturas de compra cuentan.
 *
 * `FAC-002` (auditoría 2026-09-14), patrón P5: quitar una factura de una OC era
 * un `DELETE` físico. Ahora se anula, y la fila se queda —con sus líneas, sus
 * asignaciones y su archivo— porque es un respaldo tributario.
 *
 * Eso traslada la responsabilidad a la lectura: **toda** consulta que sume,
 * concilie o liste facturas de una orden tiene que excluir las anuladas, o el
 * error que se quiso corregir volvería como un descuadre. Este predicado existe
 * para que sea una sola cosa que recordar y se pueda buscar en el árbol.
 */

import { isNull, type SQL } from "drizzle-orm"
import { purchaseOrderInvoices } from "@/db/schema"

/** Sólo las vigentes. Se compone con `and(...)` como cualquier otro filtro. */
export const invoiceNotVoided: SQL = isNull(purchaseOrderInvoices.voidedAt)
