import type { Instrumentation } from "next"
import { validateEnv } from "@/lib/env"

export async function register() {
  // Fail fast on missing required environment variables so the process
  // crashes with a clear message instead of dying deep inside a request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateEnv()
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
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const { logger } = await import("@/lib/logger")
    const digest = typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined
    logger.error("[request] error no capturado", {
      path: request.path.split("?")[0],
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      digest,
      message: err instanceof Error ? err.message : String(err),
    })
  } catch {
    // El logger no pudo escribir: no hay a dónde más reportarlo.
  }
}
