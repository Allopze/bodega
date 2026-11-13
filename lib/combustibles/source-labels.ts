/**
 * Cómo se llaman en pantalla las fuentes de datos de combustible.
 *
 * Los valores viajan con siglas de Copec (`TCT`, `TAE`) y con etiquetas de
 * importación («Copec TCT Diesel»), pero el usuario nunca debe leerlas: el mismo
 * canal tenía tres nombres según la pantalla y la sigla se colaba como
 * «proveedor» en Tarjetas (auditoría Control operacional 2026-11-13, C14/T7).
 * Única fuente de verdad para Fuentes, Tarjetas, Pagos y la sincronización.
 *
 * Sin dependencias de servidor: lo importan componentes cliente.
 */

/** Canales de Copec. */
export const COPEC_CHANNEL_LABELS = {
  TCT: "Tarjeta Copec de equipos",
  TAE: "Abastecimiento de estanques",
} as const

export type CopecChannel = keyof typeof COPEC_CHANNEL_LABELS

/** Nombre corto del canal cuando ya se sabe que es Copec (encabezados de fila). */
export const COPEC_CHANNEL_SHORT_LABELS: Record<CopecChannel, string> = {
  TCT: "Tarjeta de equipos",
  TAE: "Abastecimiento de estanques",
}

/** Tipo de tarjeta de una carga facturada (`servicio`). */
export const SERVICE_TYPE_LABELS: Record<string, string> = {
  TCT: COPEC_CHANNEL_LABELS.TCT,
  TAE: "Tarjeta Copec de abastecimiento",
}

export const FUEL_PRODUCT_SOURCE_LABELS: Record<string, string> = {
  diesel: "Diésel",
  bluemax: "BlueMax",
}

/** Otras fuentes que aparecen en la cobertura de datos. */
export const OTHER_SOURCE_LABELS = {
  telemetry: "Telemetría de equipos",
  onway: "GPS OnWay",
  wialon: "GPS Wialon",
  planilla: "Planilla de cargas",
} as const

/**
 * Etiqueta de una `fuente` de registro de consumo («Copec TCT Diesel»,
 * «Copec TCT BlueMax», «Aramco Fleet Diesel»…). Lo que no reconoce lo devuelve
 * tal cual: una fuente manual ya viene escrita por una persona.
 */
export function fuelRecordSourceLabel(fuente: string | null | undefined): string {
  const raw = (fuente ?? "").trim()
  if (!raw) return "—"
  const copec = /^copec\s+(tct|tae)\s*(.*)$/i.exec(raw)
  if (copec) {
    const channel = copec[1]!.toUpperCase() as CopecChannel
    const product = copec[2]?.trim().toLowerCase()
    const productLabel = product ? FUEL_PRODUCT_SOURCE_LABELS[product] ?? copec[2]!.trim() : null
    return productLabel ? `${COPEC_CHANNEL_LABELS[channel]} · ${productLabel}` : COPEC_CHANNEL_LABELS[channel]
  }
  const aramco = /^aramco\s+fleet\s*(.*)$/i.exec(raw)
  if (aramco) {
    const product = aramco[1]?.trim()
    return product ? `Tarjeta Aramco · ${FUEL_PRODUCT_SOURCE_LABELS[product.toLowerCase()] ?? product}` : "Tarjeta Aramco"
  }
  return raw
}
