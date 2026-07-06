import type { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"

export function dbErrMsg(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback
  // DrizzleQueryError wraps the real DB error in .cause
  const cause = (e as { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) return cause.message
  return e.message
}

export function serviceWorksiteScope(
  session: Awaited<ReturnType<typeof requirePermission>>,
): string[] | "all" {
  const scope = resolveWorksiteScope(session)
  return scope.mode === "all" ? "all" : scope.ids
}
