export function dbErrMsg(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback
  // DrizzleQueryError wraps the real DB error in .cause
  const cause = (e as { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) return cause.message
  return e.message
}
