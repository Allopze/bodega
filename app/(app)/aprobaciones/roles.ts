/**
 * Fuente única de verdad para los conjuntos de roles del flujo de aprobación.
 * Consumido por la página (`page.tsx` → props de UI) y por las Server Actions
 * (`actions.ts` → autorización). Mantenerlos aquí evita divergencias como la que
 * causó el hallazgo H-1 (la UI omitía `prevencionista` que el backend sí permite).
 *
 * Nota: no vive en `actions.ts` porque ese archivo es "use server" y solo puede
 * exportar funciones async.
 */

/** Roles que pueden aprobar/rechazar ítems EPP. */
export const EPP_APPROVER_ROLES = new Set([
  "administrador",
  "jefa_chome",
  "secretaria",
  "prevencionista",
])

/** Roles que definen el modo de despacho (decisión logística). */
export const DISPATCH_DECIDER_ROLES = new Set([
  "administrador",
  "jefa_chome",
  "secretaria",
])

export function canApproveEpp(roles: string[]): boolean {
  return roles.some((r) => EPP_APPROVER_ROLES.has(r))
}

export function canSetDispatch(roles: string[]): boolean {
  return roles.some((r) => DISPATCH_DECIDER_ROLES.has(r))
}
