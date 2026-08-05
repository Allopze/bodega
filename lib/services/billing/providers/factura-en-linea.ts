/**
 * lib/services/billing/providers/factura-en-linea.ts
 *
 * Adaptador de FacturaEnLínea.
 *
 * **Envuelve el scraping existente, no lo reescribe.** `DtePortalClient`,
 * `queryByPeriodo`, `parseDteTable`, `fetchBandejaEntrada` y `downloadDteXml`
 * siguen siendo la implementación real y siguen sirviendo al módulo de Compras
 * exactamente como antes. Acá solo se traduce su salida al modelo normalizado.
 *
 * Lo que este adaptador agrega respecto al sync de compras existente:
 *
 * - **Ventas.** El libro `rlib=ven` ya era consultable con el código existente
 *   pero nadie lo sincronizaba. Es la fuente de las cuentas por cobrar.
 * - **Resolución del RUT del cliente.** El listado de ventas del portal NO trae
 *   el RUT del receptor, solo la razón social (verificado: `parser.ts` deja
 *   `rutEmisor: null`). El RUT se obtiene del XML del documento, que además
 *   trae `FchVenc` (vencimiento) y `MntExe` (exento). Sin XML, el documento
 *   queda sin RUT y el sync lo reporta como incompleto — no se inventa.
 *
 * Capacidades que NO tiene, y por qué:
 * - pagos y movimientos bancarios: el portal es un emisor de DTE, no un banco.
 * - crear documentos: el portal sí puede emitir; la plataforma no lo usa nunca.
 */

import type { BillingProviderId } from "@/db/schema"
import { DtePortalClient } from "@/lib/services/dte-portal/client"
import { buildDtePortalClientConfig, readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { queryByPeriodo } from "@/lib/services/dte-portal/query"
import { fetchBandejaEntrada } from "@/lib/services/dte-portal/bandeja-entrada"
import { downloadDteXml } from "@/lib/services/dte-portal/download"
import type { DteDocumentRow, DteBandejaRow, DteEstadoSii } from "@/lib/services/dte-portal/types"
import { logger } from "@/lib/logger"
import {
  BillingProviderError,
  NO_CAPABILITIES,
  type BillingProvider,
  type BillingProviderCapabilities,
  type ProviderHealth,
  type ProviderInvoice,
  type ProviderInvoiceItem,
  type ProviderPage,
  type ProviderPeriodQuery,
} from "./types"
import { parseSaleDteXml } from "../dte-xml"

const PROVIDER_ID: BillingProviderId = "factura_en_linea"

export const FACTURA_EN_LINEA_CAPABILITIES: BillingProviderCapabilities = {
  ...NO_CAPABILITIES,
  canListIssuedInvoices: true,
  canListReceivedInvoices: true,
  canRetrieveXml: true,
  canRetrievePdf: true,
}

/**
 * Cuántos XML se descargan por corrida para resolver el RUT del cliente.
 * El portal responde <1s por XML con el throttle de 500 ms del cliente, así que
 * un mes completo de ventas (~45 documentos) entra sin problema. El tope existe
 * para que un período histórico grande no convierta la corrida en una descarga
 * de horas; lo que quede sin resolver se reporta y se retoma en la siguiente.
 */
const MAX_XML_ENRICHMENTS_PER_RUN = 120

export class FacturaEnLineaProvider implements BillingProvider {
  readonly id = PROVIDER_ID
  readonly label = "FacturaEnLínea"
  readonly capabilities = FACTURA_EN_LINEA_CAPABILITIES

  /** Cliente HTTP reutilizado durante toda la corrida (respeta el throttle). */
  private client: DtePortalClient | null = null

  constructor(client?: DtePortalClient) {
    this.client = client ?? null
  }

  async isConfigured(): Promise<boolean> {
    const config = await readDtePortalConfig()
    const { rutUsr, rutEmp, clave, codEmp } = config.credentials
    return Boolean(rutUsr && rutEmp && clave && codEmp)
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString()
    if (!(await this.isConfigured())) {
      return { ok: false, detail: "Faltan credenciales del portal DTE.", checkedAt }
    }
    try {
      const client = await this.resolveClient()
      // Consulta barata y de solo lectura: un período del libro de ventas.
      await queryByPeriodo(client, {
        tipo: "periodo",
        rlib: "ven",
        periodo: currentPeriod() as `${number}-${string}`,
        dia: "00",
      })
      return { ok: true, detail: "Portal accesible y respuesta parseable.", checkedAt }
    } catch (error) {
      return { ok: false, detail: redact(error), checkedAt }
    }
  }

  /**
   * Ventas del período. El portal devuelve todo el período en una respuesta
   * (verificado hasta 305 documentos), así que no hay cursor: `nextCursor` es
   * siempre null. Si eso cambiara, `reportedTotal` lo delata.
   */
  async listIssuedInvoices(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderInvoice>> {
    const client = await this.resolveClient()
    const config = await readDtePortalConfig()
    const issuerTaxId = config.credentials.rutEmp
    const accountRef = config.credentials.codEmp

    const result = await queryByPeriodo(client, {
      tipo: "periodo",
      rlib: "ven",
      periodo: assertPeriod(query.period),
      dia: "00",
    })

    const invoices: ProviderInvoice[] = []
    let enrichments = 0

    for (const row of result.docs) {
      const invoice = this.mapSaleRow(row, issuerTaxId, accountRef)
      // El listado no trae el RUT del cliente: se resuelve desde el XML, que
      // además aporta vencimiento, exento e ítems reales.
      if (!invoice.receiverTaxId && invoice.xmlUrl && enrichments < MAX_XML_ENRICHMENTS_PER_RUN) {
        enrichments++
        await this.enrichFromXml(client, invoice)
      }
      invoices.push(invoice)
    }

    return { items: invoices, nextCursor: null, reportedTotal: result.totalDocs }
  }

  /**
   * Compras del período, desde la Bandeja de Entrada del Panel Correo.
   * Reutiliza exactamente la misma extracción que el sync de Compras.
   */
  async listReceivedInvoices(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderInvoice>> {
    const client = await this.resolveClient()
    const config = await readDtePortalConfig()
    const [anio, mes] = assertPeriod(query.period).split("-") as [string, string]
    const accountRef = config.credentials.codEmp

    const { rows, totalRegistros } = await fetchBandejaEntrada(client, {
      mes,
      anio,
      codEmp: accountRef,
      estadoPlataforma: "",
      rutProveedor: "",
    })

    return {
      items: rows.map((row) => this.mapPurchaseRow(row, config.credentials.rutEmp, accountRef)),
      nextCursor: null,
      reportedTotal: totalRegistros,
    }
  }

  async getInvoiceXml(invoice: Pick<ProviderInvoice, "externalId" | "xmlUrl">): Promise<string> {
    if (!invoice.xmlUrl) {
      throw new BillingProviderError(
        "El documento no expone una URL de XML en el portal.",
        "NOT_SUPPORTED",
        PROVIDER_ID,
      )
    }
    const client = await this.resolveClient()
    const { xml } = await downloadDteXml(client, invoice.xmlUrl)
    return xml
  }

  // ── Interno ────────────────────────────────────────────────────────────────

  private async resolveClient(): Promise<DtePortalClient> {
    if (this.client) return this.client
    try {
      this.client = new DtePortalClient(await buildDtePortalClientConfig())
      return this.client
    } catch (error) {
      throw new BillingProviderError(redact(error), "NOT_CONFIGURED", PROVIDER_ID)
    }
  }

  /**
   * Completa el documento con lo que solo está en el XML: RUT del receptor,
   * vencimiento declarado, monto exento e ítems. Un fallo acá NO aborta la
   * corrida: el documento queda sin esos campos y el sync lo cuenta como
   * incompleto, que es información honesta.
   */
  private async enrichFromXml(client: DtePortalClient, invoice: ProviderInvoice): Promise<void> {
    try {
      const { xml } = await downloadDteXml(client, invoice.xmlUrl!)
      const parsed = parseSaleDteXml(xml)
      if (!parsed) {
        logger.warn(`[billing/fel] XML no parseable para folio ${invoice.folio} tipo ${invoice.docType}`)
        return
      }
      // El XML gana en los campos tributarios porque es el documento mismo; el
      // listado HTML es una vista derivada.
      invoice.receiverTaxId = parsed.receiverTaxId
      invoice.receiverName = parsed.receiverName
      invoice.dueDate = parsed.dueDate
      invoice.exemptAmount = parsed.exemptAmount
      if (parsed.netAmount !== null) invoice.netAmount = parsed.netAmount
      if (parsed.taxAmount !== null) invoice.taxAmount = parsed.taxAmount
      if (parsed.items.length > 0) {
        invoice.items = parsed.items.map((item, index): ProviderInvoiceItem => ({
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
        }))
      }
    } catch (error) {
      logger.warn(`[billing/fel] No se pudo enriquecer folio ${invoice.folio}: ${redact(error)}`)
    }
  }

  /** Fila del libro de ventas → documento normalizado. Emisor = Chome. */
  private mapSaleRow(row: DteDocumentRow, issuerTaxId: string, accountRef: string): ProviderInvoice {
    return {
      externalId:     naturalKey("sale", row.tipoDoc, row.folio, issuerTaxId, accountRef),
      direction:      "sale",
      docType:        row.tipoDoc,
      folio:          row.folio,
      issuerTaxId,
      issuerName:     null,          // el listado no lo trae; lo resuelve el sync
      receiverTaxId:  null,          // solo está en el XML
      receiverName:   row.razonSocial || null,
      issueDate:      row.fecha,
      dueDate:        null,          // solo está en el XML (FchVenc)
      currency:       "CLP",         // el portal opera en pesos; el XML lo confirmaría
      netAmount:      row.montoNeto,
      taxAmount:      deriveTax(row.montoNeto, row.montoTotal),
      exemptAmount:   null,
      totalAmount:    row.montoTotal,
      documentStatus: mapSiiStatus(row.estadoSii),
      externalStatus: row.estado || null,
      documentUrl:    row.pdfUrl,
      xmlUrl:         row.xmlUrl,
      accountRef,
      items:          [],
    }
  }

  /** Fila de la Bandeja de Entrada → documento normalizado. Receptor = Chome. */
  private mapPurchaseRow(row: DteBandejaRow, receiverTaxId: string, accountRef: string): ProviderInvoice {
    return {
      externalId:     row.nreguist
        ? `fel:bandeja:${accountRef}:${row.nreguist}`
        : naturalKey("purchase", row.tipoDoc, row.folio, row.rutEmisor, accountRef),
      direction:      "purchase",
      docType:        row.tipoDoc,
      folio:          row.folio,
      issuerTaxId:    row.rutEmisor,
      issuerName:     row.razonSocial,
      receiverTaxId,
      receiverName:   null,
      issueDate:      row.fecha,
      dueDate:        null,
      currency:       "CLP",
      netAmount:      null,          // la bandeja solo trae total
      taxAmount:      null,
      exemptAmount:   null,
      totalAmount:    row.montoTotal,
      // La bandeja no expone el estado SII (esos íconos son del panel de
      // ventas); solo el estado de la plataforma de intercambio.
      documentStatus: "unknown",
      externalStatus: row.estadoPlataforma,
      documentUrl:    row.pdfUrl,
      xmlUrl:         row.xmlUrl,
      accountRef,
      items:          [],
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Clave natural estable para un proveedor que no entrega id propio.
 * Determinista: la misma fila produce siempre el mismo `externalId`, que es lo
 * que hace idempotente la sincronización.
 */
function naturalKey(
  direction: string,
  docType: string,
  folio: number,
  taxId: string | null,
  accountRef: string,
): string {
  return `fel:${direction}:${accountRef}:${docType}:${folio}:${taxId ?? "sin-rut"}`
}

/** Traduce el estado SII del portal al vocabulario interno. */
function mapSiiStatus(estado: DteEstadoSii | null): ProviderInvoice["documentStatus"] {
  switch (estado) {
    case "aceptado":        return "accepted"
    case "rechazado":       return "rejected"
    case "anulado":         return "void"
    case "enviado":         return "issued"
    case "manual":          return "issued"
    case "pendiente_envio": return "draft"
    default:                return "unknown"
  }
}

/**
 * IVA derivado de total − neto. Solo cuando ambos existen: es una resta, no una
 * estimación de tasa, y se marca como derivada en la evidencia del sync.
 */
function deriveTax(net: number | null, total: number): number | null {
  if (net === null) return null
  return Math.round((total - net) * 100) / 100
}

function assertPeriod(period: string): `${number}-${string}` {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new BillingProviderError(
      `Período inválido: se esperaba "YYYY-MM".`,
      "PARSE_FAILED",
      PROVIDER_ID,
    )
  }
  return period as `${number}-${string}`
}

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/** Mensaje de error sin credenciales. Mismo criterio que el sync de compras. */
function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /clave|rut_usr|rut_emp|password/i.test(message)
    ? "Error de conexión con el portal DTE [detalle omitido por contener credenciales]"
    : message
}
