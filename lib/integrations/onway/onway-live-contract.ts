/**
 * Contrato del refresco en vivo de Monitoreo GPS, sin dependencias de
 * servidor: lo importan la ruta (vía `onway-live.ts` y `wialon-live.ts`) y la
 * página en el navegador.
 */

/**
 * Cada cuánto lo pide la página mientras está abierta y visible. Es el ritmo de
 * Wialon (una consulta liviana); cada proveedor decide en el servidor si de
 * verdad consulta: OnWay conserva su separación de 50 s.
 */
export const GPS_LIVE_INTERVAL_MS = 10_000

export const GPS_LIVE_ENDPOINT = "/api/flota/monitoreo/refresco"

export type GpsLiveResult =
  | { outcome: "synced"; observedAt: string }
  | {
    outcome: "skipped"
    reason: "recent" | "busy" | "cron_window"
    /**
     * Última captura de ese proveedor, cuando ya hay datos. Una página cuya
     * lectura se salteó porque otra persona (o el cron) acababa de traer datos
     * compara esta marca para saber si le toca recargar.
     */
    observedAt?: string
  }
  | { outcome: "disabled"; reason: "credentials" | "sync_disabled" | "module" }
  | { outcome: "failed"; code: string }

/** Respuesta del endpoint: el desenlace de cada proveedor por separado. */
export interface GpsLiveResponse {
  onway: GpsLiveResult
  wialon: GpsLiveResult
}

export type OnwayLiveResult = GpsLiveResult

/**
 * Lo máximo que la respuesta espera a OnWay. Su lectura puede tardar decenas
 * de segundos (login en Auth0) y Wialon se pide cada 10 s: sin tope, un OnWay
 * lento congelaría el mapa de Wialon. Pasado el tope OnWay se informa como
 * `busy` y SIGUE corriendo en el servidor; la página lo verá en la marca de
 * captura de la próxima respuesta.
 *
 * Vive acá y no en la ruta: un `route.ts` sólo puede exportar los handlers y
 * la configuración de segmento que Next reconoce, o `next build` falla.
 */
export const ONWAY_RESPONSE_DEADLINE_MS = 8_000
