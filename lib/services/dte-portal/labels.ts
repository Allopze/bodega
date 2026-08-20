/**
 * lib/services/dte-portal/labels.ts
 *
 * Etiquetas legibles para tipo de documento y estado en la plataforma —
 * compartidas entre la UI de compras (DteReceivedCard, /compras/dte) y los
 * reportes Excel para no duplicar el mismo mapeo en cada lugar que lo necesita.
 */

const DTE_TIPO_LABEL: Record<string, string> = {
  "33": "Factura Electrónica",
  "34": "Factura Exenta",
  "56": "Nota de Débito",
  "61": "Nota de Crédito",
  "52": "Guía de Despacho",
  "39": "Boleta Afecta",
  "41": "Boleta Exenta",
}

export function dteTipoLabel(tipoDte: string): string {
  return DTE_TIPO_LABEL[tipoDte] ?? `Tipo ${tipoDte}`
}

/**
 * Estado del documento EN LA PLATAFORMA. Es la única columna de estado que la
 * Bandeja de Entrada llena de verdad: `estado_sii` se escribe siempre `null`
 * porque el panel de compras no publica los íconos SII (son del libro de
 * ventas), así que mostrarlo era una columna de guiones.
 *
 * El portal lo entrega como texto libre (el `title` de `penplata.gif`), no como
 * enum: la etiqueta es el propio texto, y sólo se traduce el caso vacío.
 */
export function estadoPlataformaLabel(estado: string | null): string {
  const texto = estado?.trim()
  if (!texto) return "Sin estado en plataforma"
  return texto
}
