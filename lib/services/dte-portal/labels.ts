/**
 * lib/services/dte-portal/labels.ts
 *
 * Etiquetas legibles para tipo de documento y estado SII — compartidas entre
 * la UI de compras (DteReceivedCard, /compras/dte) y los reportes Excel para
 * no duplicar el mismo mapeo en cada lugar que lo necesita.
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

const ESTADO_SII_LABEL: Record<string, string> = {
  pendiente_envio: "Pendiente envío SII",
  enviado: "Enviado SII",
  aceptado: "Aceptado SII",
  rechazado: "Rechazado SII",
  anulado: "Anulado",
  manual: "Manual",
}

export function estadoSiiLabel(estadoSii: string | null): string {
  if (!estadoSii) return "Sin estado SII"
  return ESTADO_SII_LABEL[estadoSii] ?? estadoSii
}
