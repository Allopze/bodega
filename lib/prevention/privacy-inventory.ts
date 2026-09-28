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

import type { StateMetaInput } from "@/components/states/state-badge"

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
 * `prevention_privacy_requests.status`, con el color de su badge. Vivía como
 * constante privada del listado de solicitudes —un módulo cliente— y la ficha
 * de la solicitud, que es un server component y no puede importar valores de
 * ahí, imprimía el enum crudo (`suspendida_retencion`).
 */
export const PRIVACY_REQUEST_STATUS_META: Record<string, StateMetaInput> = {
  recibida: { label: "Recibida", variant: "default" },
  validando_identidad: { label: "Validando identidad", variant: "warning" },
  en_proceso: { label: "En proceso", variant: "info" },
  suspendida_retencion: { label: "Retención legal", variant: "danger" },
  completada: { label: "Completada", variant: "success" },
  rechazada: { label: "Rechazada", variant: "danger" },
}

/** `prevention_privacy_requests.right_type`. Lo usaban, duplicado, el listado y la ficha. */
export const PRIVACY_RIGHT_LABELS: Record<string, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  deletion: "Supresión",
  opposition: "Oposición",
  portability: "Portabilidad",
  restriction: "Restricción",
}

/**
 * `prevention_privacy_request_executions.operation`. Es el verbo de lo que se
 * hizo sobre el registro, no el derecho pedido: por eso «Supresión» y no
 * «Derecho de supresión».
 */
export const PRIVACY_EXECUTION_OPERATION_LABELS: Record<string, string> = {
  rectification: "Rectificación",
  deletion: "Supresión",
  opposition: "Oposición",
  restriction: "Restricción",
}

/** `prevention_privacy_request_executions.domain` */
export const PRIVACY_EXECUTION_DOMAIN_LABELS: Record<string, string> = {
  health_record: "Registro de salud",
  reserved_case: "Caso reservado",
  ppa: "PPA",
  document: "Documento",
  processing_restriction: "Restricción de tratamiento",
}

/** `prevention_privacy_request_executions.outcome` */
export const PRIVACY_EXECUTION_OUTCOME_LABELS: Record<string, string> = {
  applied: "Aplicada",
  partially_applied: "Aplicada parcialmente",
  blocked_retention: "Bloqueada por retención legal",
  rejected: "Rechazada",
}

/**
 * Un valor fuera del catálogo se muestra tal cual: preferimos un dato raro
 * visible a uno silenciado, porque aquí significa que el esquema cambió.
 */
export function labelOf(catalog: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—"
  return catalog[value] ?? value
}
