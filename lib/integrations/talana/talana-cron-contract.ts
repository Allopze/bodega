export type TalanaCronOutcome =
  | "success"
  | "disabled"
  | "unauthorized"
  | "rate_limited"
  | "conflict"
  | "partial"
  | "failed"

const CONTRACT = {
  success:      { ok: true,  code: "TALANA_CRON_SUCCESS",      health: "healthy",   httpStatus: 200 },
  disabled:     { ok: true,  code: "TALANA_CRON_DISABLED",     health: "healthy",   httpStatus: 200 },
  unauthorized: { ok: false, code: "TALANA_CRON_UNAUTHORIZED", health: "unhealthy", httpStatus: 401 },
  rate_limited: { ok: false, code: "TALANA_CRON_RATE_LIMITED", health: "degraded",  httpStatus: 429 },
  conflict:     { ok: false, code: "TALANA_CRON_ACTIVE_RUN",   health: "healthy",   httpStatus: 409 },
  partial:      { ok: false, code: "TALANA_CRON_PARTIAL",      health: "degraded",  httpStatus: 503 },
  failed:       { ok: false, code: "TALANA_CRON_FAILED",       health: "unhealthy", httpStatus: 503 },
} as const satisfies Record<TalanaCronOutcome, {
  ok: boolean
  code: string
  health: "healthy" | "degraded" | "unhealthy"
  httpStatus: number
}>

export function talanaCronContractFor(outcome: TalanaCronOutcome) {
  return { ...CONTRACT[outcome], outcome }
}
