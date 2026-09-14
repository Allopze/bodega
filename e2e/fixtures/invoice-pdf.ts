import { jsPDF } from "jspdf"

/**
 * Factura electrónica con capa de texto, para la extracción automática al adjuntar.
 *
 * Antes esta prueba abría `DOC-33-3064428.pdf` en la raíz del repositorio: una factura
 * real de un proveedor que no está versionada —ni debería estarlo— y que por lo tanto
 * hacía fallar el caso con ENOENT en cualquier checkout limpio y en CI.
 *
 * El documento se genera acá para que lo que la prueba afirma se lea como código. Los
 * textos siguen los patrones que reconoce `invoice-text-parser.ts`: el folio por
 * "Factura Electronica N° …", la fecha por "Fecha: DD/MM/AAAA" y los montos por sus
 * etiquetas de pie.
 */

export const INVOICE = {
  folio: "3064428",
  /** ISO corto, que es como el parser normaliza "14/07/2026". */
  issueDate: "2026-07-14",
  supplierRut: "96.919.980-1",
  net: 57_500,
  tax: 10_925,
  /** Lo que el formulario escribe en `#invoice-amount`: el total del documento. */
  total: 68_425,
} as const

const LINES = [
  "TRECK S.A.",
  `R.U.T.: ${INVOICE.supplierRut}`,
  "FACTURA ELECTRONICA",
  `Factura Electronica N° ${INVOICE.folio}`,
  "Fecha: 14/07/2026",
  "",
  "Detalle",
  "GUANTE CABRITILLA T9 10 2.500 25.000",
  "CASCO SEGURIDAD BLANCO 5 6.500 32.500",
  "",
  "MONTO NETO 57.500",
  "IVA 19% 10.925",
  "TOTAL 68.425",
]

/** Devuelve el PDF como buffer, para `setInputFiles` con nombre y mimetype explícitos. */
export function buildInvoicePdf(): Buffer {
  const doc = new jsPDF()
  doc.setFontSize(12)
  let y = 20
  for (const line of LINES) {
    if (line) doc.text(line, 14, y)
    y += 10
  }
  return Buffer.from(doc.output("arraybuffer"))
}
