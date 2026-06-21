/**
 * lib/ppa/utils.ts
 * Shared helpers for the PPA module.
 */

import type { WorksiteScope } from "@/lib/auth/scope"

/**
 * Convierte un WorksiteScope en el formato que esperan las funciones de servicio
 * PPA (`string[] | "all"`).
 */
export function scopeToIds(scope: WorksiteScope): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}
