import * as Sentry from "@sentry/nextjs"
import { setLoggerErrorSink } from "@/lib/logger"
import { depurarEventoTelemetria, RECOLECCION_MINIMA } from "@/lib/security/telemetry-scrub"

// Lo importa `register()` de instrumentation.ts sólo en el runtime nodejs y
// sólo con SENTRY_DSN definido: sin DSN no se carga el SDK.
//
// Integración sólo de runtime (2026-10-01): sin `withSentryConfig` en
// next.config.ts. Ese wrapper sumaba ~1,5 GB al pico de memoria del build y fue
// el motivo del retiro del 15-09 (commit 3e731f42c). El costo es no subir
// source maps: los stacks del navegador llegan minificados.
//
// Sólo errores: sin `tracesSampleRate` no se envían trazas de rendimiento.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() || undefined,
  dataCollection: RECOLECCION_MINIMA,
  // No reescribir el mensaje real de los errores de fetch: hay código que lo
  // compara (lib/network-error.ts). Sólo se enriquece lo que viaja a Sentry.
  enhanceFetchErrorMessages: "report-only",
  beforeSend(event) {
    return depurarEventoTelemetria(event)
  },
})

setLoggerErrorSink((error) => {
  Sentry.captureException(error)
})
