/**
 * lib/services/billing/providers/manual.ts
 *
 * Proveedor "manual": lo que una persona carga a mano o importa desde un XML.
 *
 * No es un relleno: es lo que permite que el módulo opere completo **sin
 * ninguna integración disponible**. Una factura cargada a mano tiene la misma
 * dignidad que una sincronizada; lo que cambia es su `source`, que la UI muestra
 * para que nadie confunda un dato tecleado con uno traído del portal.
 *
 * No expone métodos de listado porque no hay nada externo que listar: los
 * registros los crea la acción del usuario, no una consulta.
 */

import type { BillingProviderId } from "@/db/schema"
import {
  NO_CAPABILITIES,
  type BillingProvider,
  type BillingProviderCapabilities,
  type ProviderHealth,
  type ProviderInvoice,
} from "./types"
import { parseSaleDteXml } from "../dte-xml"
import { logger } from "@/lib/logger"

const PROVIDER_ID: BillingProviderId = "manual"

export const MANUAL_CAPABILITIES: BillingProviderCapabilities = {
  ...NO_CAPABILITIES,
  // Puede "recuperar" XML en el sentido de aceptar uno que le entreguen.
  canRetrieveXml: true,
}

export class ManualProvider implements BillingProvider {
  readonly id = PROVIDER_ID
  readonly label = "Carga manual"
  readonly capabilities = MANUAL_CAPABILITIES

  async isConfigured(): Promise<boolean> {
    return true
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ok: true,
      detail: "Siempre disponible: no depende de un servicio externo.",
      checkedAt: new Date().toISOString(),
    }
  }
}

/**
 * Convierte un XML DTE entregado por una persona en un documento normalizado.
 *
 * `direction` la decide quien carga el archivo, porque el mismo XML puede ser
 * una venta (Chome es emisor) o una compra (Chome es receptor) y el archivo por
 * sí solo no dice cuál de las dos cosas le interesa al usuario. El sync valida
 * después que el RUT de Chome esté del lado que corresponde.
 */
export function providerInvoiceFromXml(
  xml: string,
  direction: "sale" | "purchase",
): ProviderInvoice | null {
  const parsed = parseSaleDteXml(xml)
  if (!parsed) return null

  if (!parsed.currency && parsed.currencyDeclared) {
    // Moneda fuera de la tabla del SII: se avisa en vez de etiquetarla CLP en
    // silencio, igual que hace el adaptador del portal.
    logger.warn(
      `[billing/manual] Moneda "${parsed.currencyDeclared}" no reconocida en el XML `
      + `${parsed.docType}/${parsed.folio}: se asume CLP`,
    )
  }

  return {
    externalId: `manual:${direction}:${parsed.docType}:${parsed.folio}:${parsed.issuerTaxId}`,
    direction,
    docType:        parsed.docType,
    folio:          parsed.folio,
    issuerTaxId:    parsed.issuerTaxId,
    issuerName:     parsed.issuerName,
    receiverTaxId:  parsed.receiverTaxId,
    receiverName:   parsed.receiverName,
    issueDate:      parsed.issueDate,
    dueDate:        parsed.dueDate,
    // Un XML cargado a mano puede ser una factura de exportación: la moneda es
    // la que declara el documento, no un "CLP" fijo. Sólo se cae a CLP cuando
    // el XML no declara ninguna (el caso normal de un DTE nacional).
    currency:       parsed.currency ?? "CLP",
    netAmount:      parsed.netAmount,
    taxAmount:      parsed.taxAmount,
    exemptAmount:   parsed.exemptAmount,
    totalAmount:    parsed.totalAmount,
    // Un XML en mano no prueba el estado del documento en el SII.
    documentStatus: "unknown",
    externalStatus: null,
    documentUrl:    null,
    xmlUrl:         null,
    accountRef:     null,
    items: parsed.items.map((item, index) => ({
      externalItemId: String(item.lineNumber),
      description:    item.description,
      quantity:       item.quantity,
      unit:           item.unit,
      unitPrice:      item.unitPrice,
      discountAmount: item.discount,
      netAmount:      item.amount,
      taxAmount:      null,
      totalAmount:    item.amount,
      sortOrder:      index,
    })),
  }
}

export const MANUAL_PROVIDER_ID = PROVIDER_ID
