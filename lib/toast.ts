import { toast as sonnerToast } from "sonner"

/**
 * Wrapper sobre sonner: los toasts de error persisten hasta que el usuario
 * los cierre (H9 — recuperación de errores). Los de éxito conservan la
 * duración por defecto del Toaster. Importar siempre desde aquí, no de "sonner".
 */
const error: typeof sonnerToast.error = (message, options) =>
  sonnerToast.error(message, { duration: Infinity, ...options })

export const toast: typeof sonnerToast = Object.assign(
  ((...args: Parameters<typeof sonnerToast>) => sonnerToast(...args)) as typeof sonnerToast,
  sonnerToast,
  { error },
)
