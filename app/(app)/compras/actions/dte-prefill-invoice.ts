"use server"

/**
 * Precarga el formulario de factura de una OC desde un DTE ya sincronizado.
 *
 * ## Por qué existe
 *
 * La plataforma ya tiene el documento del proveedor: la Bandeja de Entrada lo
 * sincroniza a `dteDocuments` y su XML se descarga bajo demanda con un enlace
 * determinista. Aun así, para registrarlo en la OC había que ir al portal,
 * bajar el archivo y volver a subirlo acá — trabajo que la máquina ya hizo.
 *
 * El vínculo automático existente (lib/services/dte-portal/reconciliation.ts)
 * no resuelve esto: sólo une un DTE a una factura que **alguien ya tipeó**, así
 * que llega tarde para ahorrar la digitación. Esta acción invierte la
 * dirección: partir del DTE y llegar a la factura.
 *
 * ## Qué NO hace
 *
 * No escribe nada. Devuelve exactamente la misma forma que
 * `/api/purchase-orders/invoices/extract`, de modo que el formulario reutiliza
 * su propio camino de precarga y cruce de ítems, y la persona sigue
 * confirmando antes de adjuntar. Qué líneas de la OC cubre la factura es una
 * decisión que no se puede adivinar —la facturación parcial es normal— y sigue
 * siendo de quien registra.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { downloadDteDocumentXml } from "./dte-download-xml"
import type { ParsedInvoiceData } from "@/lib/services/purchasing-module/invoice-text-parser"

export interface DtePrefillResult {
  data: ParsedInvoiceData
  /** Origen de los datos, para que el aviso al operador no mienta sobre la fuente. */
  method: "dte_portal"
  quality: { totalsConsistent: boolean }
}

export type DtePrefillResponse =
  | { ok: true; result: DtePrefillResult }
  | { ok: false; error: string }

/** Peso máximo, en pesos, para dar por cuadrado neto + IVA contra el total. */
const ROUNDING_TOLERANCE_CLP = 1

export async function prefillInvoiceFromDte(dteDocumentId: string): Promise<DtePrefillResponse> {
  // `purchasing:send_order`, el mismo que exige /invoices/extract: esto
  // alimenta el alta de una factura, no es una lectura de consulta. Es más
  // estricto que el `purchasing:view` de downloadDteDocumentXml, a propósito.
  await requirePermission("purchasing:send_order")

  const doc = await db.query.dteDocuments.findFirst({
    where: eq(dteDocuments.id, dteDocumentId),
    columns: {
      id: true, folio: true, fechaEmision: true,
      rutEmisor: true, razonSocialEmisor: true, montoTotal: true,
      purchaseOrderInvoiceId: true,
    },
  })
  if (!doc) return { ok: false, error: "Documento DTE no encontrado" }

  // Un DTE ya vinculado no vuelve a ofrecerse: registrarlo de nuevo crearía
  // una segunda factura por el mismo documento tributario.
  if (doc.purchaseOrderInvoiceId) {
    return { ok: false, error: "Este DTE ya está vinculado a una factura de esta orden." }
  }

  // Reutiliza la descarga con caché write-through: la primera vez baja el XML
  // del portal, las siguientes leen el archivo ya guardado.
  const downloaded = await downloadDteDocumentXml(dteDocumentId)
  if (!downloaded.ok) return { ok: false, error: downloaded.error }

  const { netAmount, taxAmount, totalAmount, items } = downloaded.detail

  const data: ParsedInvoiceData = {
    invoiceNumber: String(doc.folio),
    issueDate: doc.fechaEmision || null,
    totalAmount,
    netAmount,
    taxAmount,
    supplierName: doc.razonSocialEmisor,
    supplierRut: doc.rutEmisor,
    items: items.map((item) => ({
      productName:   item.productName,
      productCode:   item.productCode,
      unitOfMeasure: item.unitOfMeasure,
      quantity:      item.quantity,
      unitPrice:     item.unitPrice,
      amount:        item.amount,
    })),
  }

  return {
    ok: true,
    result: {
      data,
      method: "dte_portal",
      // Mismo criterio que la extracción de archivos: si el documento no cuadra
      // consigo mismo, el formulario lo dice en vez de dejar firmar a ciegas.
      quality: {
        totalsConsistent: Math.abs(netAmount + taxAmount - totalAmount) <= ROUNDING_TOLERANCE_CLP,
      },
    },
  }
}
