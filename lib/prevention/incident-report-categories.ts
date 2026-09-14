/**
 * Catálogo puro del canal público de reportes.
 *
 * La pantalla de envío es un Client Component y sólo necesita estas opciones;
 * mantenerlas fuera del servicio que escribe en la BD evita arrastrar Drizzle
 * y el driver de PostgreSQL al bundle del navegador.
 */

export const INCIDENT_REPORT_CATEGORIES = [
  "cuasi_accidente",
  "condicion_insegura",
  "acto_inseguro",
  "accidente",
  "otro",
] as const

export const INCIDENT_REPORT_CATEGORY_LABELS: Record<string, string> = {
  cuasi_accidente: "Cuasi accidente",
  condicion_insegura: "Condición insegura",
  acto_inseguro: "Acto inseguro",
  accidente: "Accidente",
  otro: "Otro",
}

