export type TiWorksiteScope = string[] | "all"

/**
 * Services receive the resolved session scope instead of trusting identifiers
 * supplied by forms. A scoped session without assigned worksites has no access.
 */
export function assertTiWorksiteAccess(scope: TiWorksiteScope, worksiteId: string | null | undefined): void {
  if (scope !== "all" && (!worksiteId || !scope.includes(worksiteId))) {
    throw new Error("No tienes acceso a esta faena")
  }
}

export function isTiWorksiteInScope(scope: TiWorksiteScope, worksiteId: string | null | undefined): boolean {
  return scope === "all" || Boolean(worksiteId && scope.includes(worksiteId))
}

/** The access-system catalog is global because systems have no worksite key. */
export function assertTiGlobalAccess(scope: TiWorksiteScope): void {
  if (scope !== "all") throw new Error("Esta operación requiere alcance global")
}
