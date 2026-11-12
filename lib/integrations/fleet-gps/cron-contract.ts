/**
 * Contrato de los crons de GPS de flota (OnWay y Wialon). El runner reconoce
 * los mismos códigos `FLEET_GPS_CRON_*`; el nombre del job en `cron_runs` es lo
 * que distingue una corrida de otra.
 */

export type FleetGpsCronOutcome =
  | "success"
  | "disabled"
  | "unauthorized"
  | "rate_limited"
  | "conflict"
  | "partial"
  | "failed"

const CONTRACT = {
  success:      { ok: true,  code: "FLEET_GPS_CRON_SUCCESS",      health: "healthy",   httpStatus: 200 },
  disabled:     { ok: true,  code: "FLEET_GPS_CRON_DISABLED",     health: "healthy",   httpStatus: 200 },
  unauthorized: { ok: false, code: "FLEET_GPS_CRON_UNAUTHORIZED", health: "unhealthy", httpStatus: 401 },
  rate_limited: { ok: false, code: "FLEET_GPS_CRON_RATE_LIMITED", health: "degraded",  httpStatus: 429 },
  conflict:     { ok: false, code: "FLEET_GPS_CRON_ACTIVE_RUN",   health: "healthy",   httpStatus: 409 },
  partial:      { ok: false, code: "FLEET_GPS_CRON_PARTIAL",      health: "degraded",  httpStatus: 503 },
  failed:       { ok: false, code: "FLEET_GPS_CRON_FAILED",       health: "unhealthy", httpStatus: 503 },
} as const satisfies Record<FleetGpsCronOutcome, {
  ok: boolean
  code: string
  health: "healthy" | "degraded" | "unhealthy"
  httpStatus: number
}>

export function fleetGpsCronContractFor(outcome: FleetGpsCronOutcome) {
  return { ...CONTRACT[outcome], outcome }
}
