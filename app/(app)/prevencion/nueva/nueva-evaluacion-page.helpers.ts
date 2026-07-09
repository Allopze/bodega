import type { WorksiteScope } from "@/lib/auth/scope"

export function buildNuevaEvaluacionScope(scope: WorksiteScope): {
  worksiteIds: string[] | "all"
  hasRows: boolean
} {
  if (scope.mode === "all") return { worksiteIds: "all", hasRows: true }
  if (scope.mode === "some") return { worksiteIds: scope.ids, hasRows: scope.ids.length > 0 }
  return { worksiteIds: [], hasRows: false }
}
