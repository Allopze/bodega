/**
 * Vocabulario del inventario ARCO (TASK-UI-012).
 *
 * El banco de trabajo de solicitudes de privacidad lista los registros de la
 * persona titular y hasta ahora imprimía sus enums en crudo: `vigente · apto`,
 * `ley_karin · en_investigacion`, `en_revision`. Quien atiende una solicitud
 * legal tiene que decidir sobre esos registros, así que la jerga de
 * implementación es especialmente cara ahí.
 *
 * Los valores no se inventaron: son exactamente los que las restricciones
 * `check` del esquema permiten para cada columna, de modo que la traducción no
 * puede crear sinónimos ni quedarse corta.
 */

/** `prevention_health_records.record_type` */
export const HEALTH_RECORD_TYPE_LABELS: Record<string, string> = {
  aptitud: "Aptitud",
  vigilancia: "Vigilancia médica",
  examen_ocupacional: "Examen ocupacional",
  evaluacion_exposicion: "Evaluación de exposición",
}

/** `prevention_health_records.status` */
export const HEALTH_RECORD_STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  vigente: "Vigente",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

/** `prevention_health_records.fitness_status` */
export const HEALTH_FITNESS_LABELS: Record<string, string> = {
  pendiente: "Aptitud pendiente",
  apto: "Apto",
  apto_con_restricciones: "Apto con restricciones",
  no_apto: "No apto",
}

/** `prevention_reserved_cases.category` */
export const RESERVED_CASE_CATEGORY_LABELS: Record<string, string> = {
  ley_karin: "Ley Karin",
  denuncia_reservada: "Denuncia reservada",
  investigacion_interna: "Investigación interna",
}

/** `prevention_reserved_cases.status` */
export const RESERVED_CASE_STATUS_LABELS: Record<string, string> = {
  abierto: "Abierto",
  en_investigacion: "En investigación",
  cerrado: "Cerrado",
  archivado: "Archivado",
}

/** `sst_documents.status` */
export const SST_DOCUMENT_STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  observado: "Observado",
  aprobado: "Aprobado",
  vigente: "Vigente",
  vencido: "Vencido",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

/**
 * Un valor fuera del catálogo se muestra tal cual: preferimos un dato raro
 * visible a uno silenciado, porque aquí significa que el esquema cambió.
 */
export function labelOf(catalog: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—"
  return catalog[value] ?? value
}
