/** Roles whose responsibilities are always tied to at least one worksite. */
export const WORKSITE_SCOPED_ROLE_NAMES = [
  "solicitante_faena",
  "prevencionista_faena",
  "conductor_lider",
  "admin_contrato",
  "jefe_terreno",
  "supervisor_terreno",
  "cphs",
] as const

export function requiresWorksiteAssignment(roleName: string) {
  return (WORKSITE_SCOPED_ROLE_NAMES as readonly string[]).includes(roleName)
}
