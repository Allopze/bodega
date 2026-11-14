/**
 * Clasificación de las alertas de OnWay (`fleet_gps_alerts`).
 *
 * La tabla trae `alertType` (un número en texto) y `category`, pero `category`
 * es «unknown» en la práctica y `alertType` no tiene catálogo propio: el
 * significado vive sólo en `title`, redactado por Entel («El dispositivo KA-144
 * ha excedido la velocidad en segmento vial, límite de 50 km/h.», «Inicio de
 * ralentí, dispositivo KA-138», «… frenó bruscamente»). Por eso se clasifica por
 * el texto, con expresiones que toleran tildes y mayúsculas.
 *
 * Es una función pura: sin acceso a datos, la comparten el servicio de
 * indicadores y sus pruebas.
 */

export type GpsAlertClass = "speeding" | "harsh_driving" | "pothole" | "idle" | "operational" | "other"

/**
 * Clases que se cuentan y se grafican. `operational` (encendido, apagado,
 * movimiento, detención y fin de ralentí) queda fuera a propósito: son eventos
 * de funcionamiento normal que ocurren decenas de veces al día por equipo y
 * ahogarían a las alertas de conducción.
 */
export const COUNTED_GPS_ALERT_CLASSES = ["speeding", "harsh_driving", "pothole", "idle", "other"] as const
export type CountedGpsAlertClass = (typeof COUNTED_GPS_ALERT_CLASSES)[number]

export const GPS_ALERT_CLASS_LABELS: Record<GpsAlertClass, string> = {
  speeding: "Exceso de velocidad",
  harsh_driving: "Conducción brusca",
  pothole: "Bache",
  idle: "Ralentí",
  operational: "Operación normal",
  other: "Otras",
}

export function isCountedGpsAlertClass(value: GpsAlertClass): value is CountedGpsAlertClass {
  return value !== "operational"
}

/** Minúsculas y sin tildes: «Ralentí» y «RALENTI» caen en la misma expresión. */
function normalize(title: string): string {
  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

// El orden de las reglas importa: «Fin de ralentí» debe resolverse antes que
// «ralentí» a secas, y las alertas de conducción antes que el «se movió» genérico.
const FIN_RALENTI = /\bfin de ralenti\b/
const INICIO_RALENTI = /\binicio de ralenti\b|\bralenti\b/
const SPEEDING = /exced\w*\s+(?:de\s+|la\s+)?velocidad|exceso de velocidad|limite de \d+\s*km\s*\/\s*h/
const HARSH = /brusc/
const POTHOLE = /\bbaches?\b/
const OPERATIONAL = /\bfue (?:apagado|encendido)\b|\b(?:apagado|encendido)\b|\bse (?:movio|detuvo)\b|\bmovimiento\b|\bdetenido\b|\bdetencion\b/

export function classifyGpsAlert(title: string | null | undefined): GpsAlertClass {
  if (!title) return "other"
  const text = normalize(title)
  if (FIN_RALENTI.test(text)) return "operational"
  if (INICIO_RALENTI.test(text)) return "idle"
  if (SPEEDING.test(text)) return "speeding"
  if (HARSH.test(text)) return "harsh_driving"
  if (POTHOLE.test(text)) return "pothole"
  if (OPERATIONAL.test(text)) return "operational"
  return "other"
}
