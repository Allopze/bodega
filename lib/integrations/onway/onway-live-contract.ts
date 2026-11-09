/**
 * Contrato del refresco en vivo de Monitoreo GPS, sin dependencias de
 * servidor: lo importan la ruta (vía `onway-live.ts`) y la página en el
 * navegador.
 */

/** Cada cuánto lo pide la página mientras está abierta y visible. */
export const ONWAY_LIVE_INTERVAL_MS = 60_000

export const ONWAY_LIVE_ENDPOINT = "/api/flota/monitoreo/refresco"

export type OnwayLiveResult =
  | { outcome: "synced"; observedAt: string }
  | { outcome: "skipped"; reason: "recent" | "busy" | "cron_window" }
  | { outcome: "disabled"; reason: "credentials" | "sync_disabled" | "module" }
  | { outcome: "failed"; code: string }
