/**
 * Opciones A4 compartidas por las rutas de PDF (OC, acta SST, comprobante de
 * entrega). Todas renderizan una hoja HTML continua y dejan que Chromium la
 * pagine, así que lo único que necesitan en común es el pie corrido con la
 * numeración y una caja de página idéntica en todas las hojas.
 *
 * El `margin` que se pasa aquí debe coincidir con el `@page { margin }` del CSS
 * del documento: Chromium no define con claridad quién gana entre el CSS y el
 * parámetro de `printToPDF`, y con ambos iguales el resultado es el mismo gane
 * quien gane.
 */

export type PdfMargin = { top: string; right: string; bottom: string; left: string }

/**
 * Caja por defecto: 12mm en tres lados —los mismos que daba el padding de la
 * hoja, así la columna de texto no se angosta— y 20mm abajo para la banda del
 * pie numerado.
 */
export const A4_MARGIN: PdfMargin = {
  top: "12mm",
  right: "12mm",
  bottom: "20mm",
  left: "12mm",
}

// El template del pie es un documento aparte: no hereda estilos ni fuentes de
// la página y Chromium lo renderiza con font-size 0 si no se fija uno inline.
const FOOTER_TEMPLATE = `<div style="width:100%;margin:0 12mm;font-family:Arial,Helvetica,sans-serif;font-size:7pt;color:#6a746d;text-align:center">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`

// Con displayHeaderFooter activo y sin headerTemplate, Chromium imprime su
// cabecera por defecto (título + URL). Un elemento vacío la suprime. No usamos
// cabecera propia: se duplicaría con la cabecera de empresa de la primera hoja.
const EMPTY_HEADER_TEMPLATE = `<span></span>`

/** Opciones A4 con pie corrido numerado. */
export function a4PdfOptions(margin: PdfMargin = A4_MARGIN) {
  return {
    format: "A4" as const,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: EMPTY_HEADER_TEMPLATE,
    footerTemplate: FOOTER_TEMPLATE,
    margin,
  }
}
