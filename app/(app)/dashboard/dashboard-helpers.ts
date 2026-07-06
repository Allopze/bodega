import { resolveWorksiteScope } from "@/lib/auth/scope"

export function scopeToWorksiteIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}
