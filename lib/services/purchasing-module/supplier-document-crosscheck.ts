/**
 * ¿Este documento de proveedor ya está en el otro libro?
 *
 * `E2E-003` (auditoría 2026-09-14). La plataforma tiene **dos** registros para
 * la misma clase de documento y ninguno referencia al otro:
 *
 *  1. `purchase_order_invoices`, que cuelga de la OC, guarda el archivo y las
 *     líneas y alimenta la conciliación de tres vías.
 *  2. `billing_invoices` con `direction = 'purchase'`, que llega por
 *     sincronización, tiene identidad tributaria canónica, detección de
 *     duplicados, vencimiento, estado de cobranza y **pagos**.
 *
 * El mismo documento puede quedar registrado dos veces sin que nada lo note: la
 * detección de duplicados de facturación sólo mira su propio libro.
 *
 * **Qué es esto y qué no.** Decidir cuál de los dos es el libro único es una
 * decisión de producto que este módulo no toma —unificarlos cambia quién manda
 * sobre el pago y sobre la conciliación—. Lo que sí puede hacerse sin esa
 * decisión, y es lo que el plan de remediación pide como medida intermedia, es
 * la **comprobación cruzada**: avisar cuando el documento que se está cargando
 * ya existe al otro lado, para que nadie lo registre dos veces creyendo que es
 * nuevo. Detecta; no fusiona.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { billingInvoices, purchaseOrderInvoices, purchaseOrders } from "@/db/schema"

/** El RUT como identidad: sin puntos, sin guion, en mayúscula. */
export function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9kK]/g, "").toUpperCase()
}

/**
 * El folio como número. Los proveedores lo escriben con ceros a la izquierda, con
 * prefijos de serie y con separadores; comparar el texto crudo daría falsos
 * negativos justo donde importa.
 */
export function normalizeFolio(value: string | number | null | undefined): number | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "")
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/** Los tipos de DTE que corresponden a cada clase de documento de compra. */
const DOC_TYPES_BY_KIND: Record<"invoice" | "credit_note", readonly string[]> = {
  invoice: ["33", "34", "46", "56"],
  credit_note: ["61"],
}

export interface CrossBookMatch {
  /** En qué libro está el gemelo. */
  book: "billing" | "purchasing"
  id: string
  folio: number
  docType: string
  /** Código de la OC, cuando el gemelo vive en el libro de compras. */
  purchaseOrderCode?: string | null
}

/**
 * Busca en `billing_invoices` un documento de compra con la misma identidad
 * tributaria que el que se va a cargar en una OC.
 */
export async function findInBillingBook(
  input: { issuerTaxId: string | null | undefined; invoiceNumber: string; documentKind: "invoice" | "credit_note" },
  client: typeof db | Tx = db,
): Promise<CrossBookMatch | null> {
  const rut = normalizeTaxId(input.issuerTaxId)
  const folio = normalizeFolio(input.invoiceNumber)
  if (!rut || folio === null) return null

  const [row] = await client
    .select({ id: billingInvoices.id, folio: billingInvoices.folio, docType: billingInvoices.docType })
    .from(billingInvoices)
    .where(and(
      eq(billingInvoices.direction, "purchase"),
      eq(billingInvoices.folio, folio),
      sql`upper(regexp_replace(${billingInvoices.issuerTaxId}, '[^0-9kK]', '', 'g')) = ${rut}`,
      inArray(billingInvoices.docType, [...DOC_TYPES_BY_KIND[input.documentKind]]),
    ))
    .limit(1)

  return row ? { book: "billing", id: row.id, folio: row.folio, docType: row.docType } : null
}

/**
 * La dirección contraria: busca en `purchase_order_invoices` el gemelo de un
 * documento que llegó por sincronización al libro de facturación.
 */
export async function findInPurchasingBook(
  input: { issuerTaxId: string | null | undefined; folio: number; docType: string },
  client: typeof db | Tx = db,
): Promise<CrossBookMatch | null> {
  const rut = normalizeTaxId(input.issuerTaxId)
  if (!rut) return null
  const kind: "invoice" | "credit_note" = DOC_TYPES_BY_KIND.credit_note.includes(input.docType)
    ? "credit_note"
    : "invoice"

  const [row] = await client
    .select({
      id: purchaseOrderInvoices.id,
      invoiceNumber: purchaseOrderInvoices.invoiceNumber,
      purchaseOrderCode: purchaseOrders.code,
    })
    .from(purchaseOrderInvoices)
    .innerJoin(purchaseOrders, eq(purchaseOrderInvoices.purchaseOrderId, purchaseOrders.id))
    .where(and(
      eq(purchaseOrderInvoices.documentKind, kind),
      // FAC-002: una factura anulada no ocupa la identidad de nadie.
      sql`${purchaseOrderInvoices.voidedAt} IS NULL`,
      sql`nullif(regexp_replace(${purchaseOrderInvoices.invoiceNumber}, '[^0-9]', '', 'g'), '')::bigint = ${input.folio}`,
      sql`upper(regexp_replace(coalesce(${purchaseOrderInvoices.documentSupplierRut}, ''), '[^0-9kK]', '', 'g')) = ${rut}`,
    ))
    .limit(1)

  return row
    ? {
        book: "purchasing",
        id: row.id,
        folio: input.folio,
        docType: input.docType,
        purchaseOrderCode: row.purchaseOrderCode,
      }
    : null
}

/** El aviso, en la voz de quien lo va a leer. */
export function describeCrossBookMatch(match: CrossBookMatch): string {
  return match.book === "billing"
    ? `Este documento (tipo ${match.docType}, folio ${match.folio}) ya existe en Facturación como factura de proveedor. `
      + "Revísalo antes de cargarlo otra vez: los dos libros no se conocen entre sí."
    : `Este documento (tipo ${match.docType}, folio ${match.folio}) ya está adjunto a la orden `
      + `${match.purchaseOrderCode ?? "de compra"}. Revísalo antes de registrarlo otra vez.`
}
