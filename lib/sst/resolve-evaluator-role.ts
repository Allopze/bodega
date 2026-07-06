import type { EvaluatorRole } from "./types"

export interface ResolveEvaluatorRoleInput {
  permissions: string[]
  roles: string[]
}

export function resolveEvaluatorRole(input: ResolveEvaluatorRoleInput): EvaluatorRole | undefined {
  const { permissions, roles } = input

  if (permissions.includes("sst:evaluate_acompanamiento") && !permissions.includes("sst:create")) {
    return "conductor_lider"
  }
  if (permissions.includes("sst:create")) {
    if (roles.includes("admin_contrato")) return "admin_contrato"
    return "prevencionista_faena"
  }
  return undefined
}
