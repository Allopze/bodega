import type { Instrumentation } from "next"
import { validateEnv } from "@/lib/env"
import { configureZodLocale } from "@/lib/validation/zod-locale"

export async function register() {
  // Antes que cualquier request: los mensajes de validación que devuelven las
  // server actions salen de aquí (ver lib/validation/zod-locale.ts).
  configureZodLocale()

  // Fail fast on missing required environment variables so the process
  // crashes with a clear message instead of dying deep inside a request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateEnv()
    // Sin DSN el SDK ni se carga: desarrollo, CI y QA quedan sin telemetría.
    // No hay config edge: desde Next 16 el proxy corre en nodejs y ninguna ruta
    // declara `runtime = "edge"`.
    if (process.env.SENTRY_DSN?.trim()) {
      await import("./sentry.server.config")
    }
  }
}

/**
 * Errores de servidor que ninguna ruta capturó (PREV-I13). Sin esto, un fallo
 * en un Server Component o en una Server Action sólo quedaba en lo que Next
 * imprimiera, sin el formato del logger ni su redacción de datos sensibles.
 *
 * Se registra la ruta sin query (puede traer tokens) y nunca los headers
 * (cookies de sesión). Nunca lanza: un fallo aquí no debe tapar el error
 * original.
 *
 * Con SENTRY_DSN se reporta además a Sentry con el `Error` real (stack
 * incluido); `beforeSend` (lib/security/telemetry-scrub.ts) recorta la query,
 * descarta las cabeceras sensibles y enmascara RUT/correos del mensaje. El log
 * que escribe esta función no lleva el `Error`, así que el sink del logger no
 * lo duplica.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err
    ? String((err as { digest: unknown }).digest)
    : undefined
  try {
    const { logger } = await import("@/lib/logger")
    logger.error("[request] error no capturado", {
      path: request.path.split("?")[0],
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      digest,
      message: err instanceof Error ? err.message : String(err),
    })
  } catch {
    // El logger no pudo escribir: Sentry, abajo, es la otra vía.
  }
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN?.trim()) return
  try {
    const Sentry = await import("@sentry/nextjs")
    // El digest es lo que ve el usuario en la pantalla de error: como tag
    // permite ubicar el evento a partir de un reporte de soporte.
    Sentry.withScope((scope) => {
      if (digest) scope.setTag("digest", digest)
      Sentry.captureRequestError(err, request, context)
    })
  } catch {
    // Sentry no está disponible: el error ya quedó (o intentó quedar) en stdout.
  }
}
