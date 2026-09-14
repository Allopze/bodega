/**
 * `COT-004` (auditoría 2026-09-14): con qué `Content-Type` se sirve una cotización.
 *
 * La carga acepta PDF, JPG y PNG y los valida por bytes mágicos, pero la
 * descarga respondía `application/pdf` **sólo** si la ruta interna terminaba en
 * `.pdf` —y esa ruta se construía con la extensión del nombre que mandó el
 * cliente—, así que toda imagen legítima salía como `application/octet-stream`:
 * el navegador la descargaba en vez de mostrarla, y una extensión equivocada
 * bastaba para arruinar el tipo de una evidencia válida.
 *
 * El criterio que se copia es el de las otras descargas del repositorio
 * (adjuntos de entrega, documentos de mantención, facturas de OC): servir el
 * MIME **persistido** al cargar, no el adivinado al leer.
 *
 * LO QUE NO SE ABRE. La lista blanca es cerrada y contiene sólo los tres tipos
 * que `MimeType.QUOTATION` acepta. Un valor fuera de ella —hoy imposible por el
 * CHECK de base, mañana posible si alguien agrega un camino de escritura— se
 * degrada a binario genérico y a `attachment`. Nunca se sirve `text/html` ni
 * ningún tipo activo desde una carga de usuario: sería un XSS almacenado en el
 * mismo origen de la aplicación.
 */

/** Los tipos que una cotización puede tener y que es seguro mostrar en línea. */
export const QUOTATION_SERVABLE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
])

/** Extensión interna derivada del MIME autoritativo, no del nombre del cliente. */
export const QUOTATION_EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
}

/**
 * Compatibilidad con las filas anteriores a la migración 0306, que no tienen
 * MIME guardado: se deduce de la extensión interna, que para ellas es la única
 * pista que existe. No se relee el archivo: eso sería un cambio de coste en una
 * ruta de descarga caliente y no cambia el resultado en la práctica.
 */
function legacyMimeFromPath(filePath: string): string | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  return null
}

export interface QuotationContentHeaders {
  contentType: string
  /** `inline` sólo para los tipos que la plataforma acepta y sabe mostrar. */
  disposition: "inline" | "attachment"
}

export function resolveQuotationContentType(
  mimeType: string | null | undefined,
  filePath: string,
): QuotationContentHeaders {
  const persisted = mimeType?.trim() || null
  const resolved = persisted ?? legacyMimeFromPath(filePath)
  if (resolved && QUOTATION_SERVABLE_MIME_TYPES.has(resolved)) {
    return { contentType: resolved, disposition: "inline" }
  }
  return { contentType: "application/octet-stream", disposition: "attachment" }
}
