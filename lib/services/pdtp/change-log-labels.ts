/**
 * Categoría legible de una entrada de `pdtp_change_log` (PREV-K01). La
 * sección guarda un prefijo técnico y un identificador interno
 * (`obligation:pdtp-obligation-gkQ…`, `assignee:78`) que la pantalla mostraba
 * tal cual; la nota ya describe el cambio, así que basta con nombrar su tipo.
 */
const CATEGORY_BY_PREFIX: Record<string, string> = {
  activity: "Actividad",
  approval: "Aprobación del programa",
  approval_flow: "Aprobación del programa",
  assignee: "Asignación",
  closure: "Cierre mensual",
  deviation: "Desvío",
  document_history: "Documento",
  execution: "Ejecución",
  executors: "Ejecutores",
  import: "Importación",
  lifecycle: "Ciclo de vida",
  metadata: "Datos del programa",
  objectives: "Objetivos",
  obligation: "Obligación",
  override: "Ajuste de meta",
  pdtp_program_activity: "Actividad",
  revision: "Revisión",
  schedule: "Planificación",
  scheduled_instance: "Ocurrencia programada",
  template: "Plantilla",
  worksite_adjustment: "Ajuste por faena",
  worksite_exclusion: "Exclusión por faena",
  worksites: "Faenas",
}

export function pdtpChangeLogCategory(section: string): string {
  const prefix = section.split(":", 1)[0] ?? ""
  return CATEGORY_BY_PREFIX[prefix] ?? "Cambio"
}
