/**
 * Sentry en el navegador.
 *
 * `NEXT_PUBLIC_SENTRY_DSN` se inlinea en el build: si la imagen se construyó
 * sin él, `DSN` queda vacío y el SDK no se descarga nunca. Con DSN se carga en
 * un chunk diferido, fuera del first-load JS de todas las rutas: el costo es que
 * un error lanzado en los primeros milisegundos, antes de que el chunk llegue,
 * no se reporta.
 *
 * Se usa `@sentry/browser` y no `@sentry/nextjs`: para capturar errores basta
 * el SDK de navegador, sin la capa React ni la instrumentación del router. El
 * `import()` apunta a `sentry-browser-sdk.ts` y no al paquete: un namespace
 * dinámico no admite tree-shaking y el chunk arrastraría Replay y Feedback.
 */
import { depurarEventoTelemetria, RECOLECCION_MINIMA } from "@/lib/security/telemetry-scrub"

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() ?? ""

type SentryBrowser = typeof import("./sentry-browser-sdk")

let sdk: Promise<SentryBrowser> | null = null

function loadSentry(): Promise<SentryBrowser> | null {
  if (!DSN) return null
  sdk ??= import("./sentry-browser-sdk").then((Sentry) => {
    Sentry.init({
      dsn: DSN,
      environment: process.env.NODE_ENV,
      dataCollection: RECOLECCION_MINIMA,
      // No reescribir el mensaje real de los errores de fetch: hay código que lo
      // compara (lib/network-error.ts). Sólo se enriquece lo que viaja a Sentry.
      enhanceFetchErrorMessages: "report-only",
      // Sólo errores: sin `tracesSampleRate` no viajan trazas, y no se activa
      // Session Replay (grabaría pantallas con RUT y datos de salud).
      beforeSend(event) {
        return depurarEventoTelemetria(event)
      },
    })
    return Sentry
  })
  return sdk
}

/** Lo llama `instrumentation-client.ts` al arrancar la app. */
export function initClientSentry(): void {
  loadSentry()?.catch(() => {
    // El chunk no cargó (bloqueador, red): la app sigue igual sin telemetría.
  })
}

/**
 * Reporta el error que atrapó un error boundary. React 19 no lo propaga a
 * `window.onerror`, así que sin esto un fallo de render en el navegador nunca
 * llega a Sentry.
 *
 * Un error con `digest` nació en el servidor: el navegador sólo recibe un
 * mensaje genérico y el evento real ya lo reportó `onRequestError` con stack;
 * enviarlo de nuevo sólo agregaría ruido.
 */
export function reportBoundaryError(error: Error & { digest?: string }): void {
  if (error.digest) return
  loadSentry()
    ?.then((Sentry) => {
      Sentry.captureException(error, { mechanism: { handled: true, type: "auto.react.error_boundary" } })
    })
    .catch(() => {})
}
