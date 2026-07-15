import { logger } from "@/lib/logger"

/**
 * Nunca devuelve al navegador detalles de drivers, SQL o infraestructura.
 * Los errores de validación se tratan antes de llegar aquí para conservar los
 * fieldErrors que necesita cada formulario.
 */
export function unexpectedActionError(error: unknown, action: string) {
  logger.error(`[${action}]`, error)
  return {
    ok: false as const,
    message: "No se pudo completar la acción. Intenta nuevamente.",
  }
}
