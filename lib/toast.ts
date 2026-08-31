import type { CSSProperties } from "react"
import { toast as sonnerToast } from "sonner"
import { userFacingErrorText } from "@/lib/user-facing-error"

/**
 * Duración por defecto para los toasts de error.
 * El Toaster base usa 4000ms para success/info/warning.
 */
export const DEFAULT_TOAST_DURATION = 5000

/**
 * Wrapper sobre sonner:
 * - Los toasts de error se cierran automáticamente tras DEFAULT_TOAST_DURATION ms
 *   y muestran una barra de progreso que indica el tiempo restante.
 * - Los de éxito/info/warning conservan la duración por defecto del Toaster (4000ms).
 * Importar siempre desde aquí, no de "sonner".
 */
const error: typeof sonnerToast.error = (message, options) => {
  const duration = options?.duration ?? DEFAULT_TOAST_DURATION
  const safeMessage = typeof message === "string"
    ? userFacingErrorText(message) ?? "No se pudo completar la acción. Intenta nuevamente."
    : message
  return sonnerToast.error(safeMessage, {
    ...options,
    duration,
    style: { "--progress-duration": `${duration}ms`, ...options?.style } as CSSProperties,
  })
}

export const toast: typeof sonnerToast = Object.assign(
  ((...args: Parameters<typeof sonnerToast>) => sonnerToast(...args)) as typeof sonnerToast,
  sonnerToast,
  { error },
)
