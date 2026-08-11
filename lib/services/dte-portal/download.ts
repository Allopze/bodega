/**
 * lib/services/dte-portal/download.ts
 *
 * Descarga on-demand de XML y PDF desde el portal DTE FacturaEnLinea.
 *
 * Los documentos no se descargan automáticamente durante la sincronización
 * (demasiada latencia). En su lugar, se descargan bajo demanda desde la
 * página de admin o reconciliación.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 12–13
 */

import { DtePortalClient, decodeXmlBuffer } from "./client"
import { DtePortalError } from "./types"
import { resolveDtePortalResourceUrl } from "./portal-origin"

/**
 * Descarga el XML de un DTE y lo retorna como string decodificado.
 *
 * El XML puede estar en ISO-8859-1 (lo habitual) o UTF-8.
 * decodeXmlBuffer() se encarga de detectar la codificación.
 */
export async function downloadDteXml(
  client: DtePortalClient,
  xmlUrl: string,
): Promise<{ xml: string; buffer: Buffer }> {
  if (!xmlUrl) {
    throw new DtePortalError("No se proporcionó URL de XML", "INVALID_RESPONSE")
  }

  const fullUrl = resolveUrl(client, xmlUrl)
  const buffer = await client.downloadBinary(fullUrl)

  // Verificar que es XML (buscar declaración <?xml o <DTE o <EnvioDTE)
  const head = buffer.toString("latin1", 0, Math.min(buffer.length, 512)).trim()
  if (!head.startsWith("<?xml") && !head.startsWith("<DTE") && !head.startsWith("<EnvioDTE") && !head.includes("<DTE")) {
    throw new DtePortalError(
      "El contenido descargado no parece ser un XML DTE válido",
      "INVALID_RESPONSE",
    )
  }

  const xml = decodeXmlBuffer(buffer)
  return { xml, buffer }
}

/**
 * Descarga el PDF de un DTE y lo retorna como buffer binario.
 *
 * @param cedible - Si true, solicita la copia cedible/factoring (Ced=1).
 */
export async function downloadDtePdf(
  client: DtePortalClient,
  pdfUrl: string,
  cedible = false,
): Promise<Buffer> {
  if (!pdfUrl) {
    throw new DtePortalError("No se proporcionó URL de PDF", "INVALID_RESPONSE")
  }

  let fullUrl = resolveUrl(client, pdfUrl)
  if (cedible && !fullUrl.includes("Ced=")) {
    fullUrl += (fullUrl.includes("?") ? "&" : "?") + "Ced=1"
  }

  const buffer = await client.downloadBinary(fullUrl)

  // Verificar cabecera PDF
  const header = buffer.toString("latin1", 0, Math.min(buffer.length, 10))
  if (!header.startsWith("%PDF")) {
    throw new DtePortalError(
      "El contenido descargado no es un PDF válido",
      "INVALID_RESPONSE",
    )
  }

  return buffer
}

/** Resuelve una URL relativa contra la base del cliente. */
function resolveUrl(client: DtePortalClient, relativeUrl: string): string {
  try {
    return resolveDtePortalResourceUrl(relativeUrl, client.baseUrl)
  } catch {
    throw new DtePortalError("La descarga DTE apunta fuera del origen permitido", "INVALID_RESPONSE")
  }
}
