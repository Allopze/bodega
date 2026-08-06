/**
 * Nombre del cargo `admin_contrato`, que depende del contrato de cada faena.
 *
 * "Administrador de contrato" y "Supervisor de faena" son la misma persona: el
 * contrato de la faena decide cuál de los dos títulos se usa, así que el nombre
 * vive en `worksites.admin_contrato_label` y no en una constante.
 *
 * No confundir con el rol `supervisor_terreno` (SUP en la planilla PDTP), que
 * es otro cargo y trabaja junto al Jefe de terreno.
 */

export const ADMIN_CONTRATO_DEFAULT_LABEL = "Administrador de contrato"

/** Los dos títulos en uso; alimenta el selector del formulario de faena. */
export const ADMIN_CONTRATO_LABEL_OPTIONS = [
  ADMIN_CONTRATO_DEFAULT_LABEL,
  "Supervisor de faena",
] as const

/**
 * Resuelve el título para una faena. `null`/vacío —el caso normal— cae al
 * nombre por defecto; una vista sin faena en contexto (encabezado de tabla que
 * cruza faenas, builder de checklists a nivel de programa) llama sin argumento.
 */
export function adminContratoLabel(worksiteLabel?: string | null): string {
  return worksiteLabel?.trim() || ADMIN_CONTRATO_DEFAULT_LABEL
}

/**
 * Nombre de los tres roles evaluadores de una evaluación SST. Existe porque el
 * ternario `role === 'admin_contrato' ? … : …` estaba repetido en cinco vistas
 * y sólo una podía saber el título que usa el contrato de la faena.
 */
export function evaluatorRoleLabel(role: string | null | undefined, worksiteLabel?: string | null): string {
  switch (role) {
    case "admin_contrato":       return adminContratoLabel(worksiteLabel)
    case "conductor_lider":      return "Conductor líder"
    case "prevencionista_faena": return "Prevencionista de faena"
    default:                     return role ?? ""
  }
}

/**
 * Nombre del rol responsable de una acción correctiva PPA. Vocabulario propio
 * del PPA: agrega `prevencionista` y `jefe_faena`, que no son roles del sistema
 * (el equivalente RBAC de `jefe_faena` es `jefe_terreno`).
 */
export function ppaResponsibleRoleLabel(role: string | null | undefined, worksiteLabel?: string | null): string {
  switch (role) {
    case "prevencionista": return "Jefe del Departamento de Prevención de Riesgos"
    case "jefe_faena":     return "Jefe de faena"
    default:               return evaluatorRoleLabel(role, worksiteLabel)
  }
}
