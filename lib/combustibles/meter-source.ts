/** Etiquetas únicas para la fuente de una serie de medidor. */
export const METER_SOURCE_LABEL: Record<string, string> = {
  copec_tct: "Copec",
  gps_wialon: "GPS Wialon",
  gps_onway: "GPS OnWay",
}

export function meterSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return METER_SOURCE_LABEL[source] ?? source
}
