/**
 * Cómo se imprime cada documento que también se archiva. La ruta de descarga y
 * el archivado leen la misma especificación, así que el PDF que queda en
 * Cloudreve es el mismo que baja el usuario. La copia del acta SST en
 * Documentación antes salía sin márgenes ni pie numerado porque repetía el
 * render a mano.
 *
 * Módulo puro: sin navegador ni `next/*`.
 */
import { a4PdfOptions, type PdfMargin } from "./page-options"

export type PrintDocumentId = "entrega" | "inspeccion" | "sst"

export interface PrintDocumentSpec {
  id: PrintDocumentId
  /** Ruta de la página de impresión del documento. */
  path: (entityId: string) => string
  waitUntil: "domcontentloaded" | "networkidle"
  /** Espera (acotada) a que carguen las imágenes servidas por HTTP. */
  waitForImages: boolean
  margin?: PdfMargin
}

/**
 * Atributo que la página de impresión pone cuando renderizó el documento. El
 * archivado exige verlo: una redirección al login o un 404 también responden
 * HTML, y sin esta marca se habrían guardado como si fueran el documento.
 */
export const PRINT_READY_ATTRIBUTE = "data-print-ready"

export const PRINT_DOCUMENT_SPECS: Record<PrintDocumentId, PrintDocumentSpec> = {
  entrega: {
    id: "entrega",
    path: (id) => `/entregas/${encodeURIComponent(id)}/print`,
    waitUntil: "domcontentloaded",
    waitForImages: false,
    // El comprobante tiene su propia caja (más angosta): debe coincidir con el
    // @page de delivery-print-styles.ts.
    margin: { top: "12mm", right: "14mm", bottom: "20mm", left: "14mm" },
  },
  inspeccion: {
    id: "inspeccion",
    path: (id) => `/prevencion/inspecciones/${encodeURIComponent(id)}/print`,
    waitUntil: "domcontentloaded",
    // El acta puede traer miniaturas de evidencia servidas por HTTP: con
    // `domcontentloaded` a secas el PDF sale antes de que carguen.
    waitForImages: true,
  },
  sst: {
    id: "sst",
    path: (id) => `/sst/${encodeURIComponent(id)}/print`,
    waitUntil: "domcontentloaded",
    waitForImages: false,
  },
}

export function printPdfOptions(spec: PrintDocumentSpec) {
  return a4PdfOptions(spec.margin)
}
