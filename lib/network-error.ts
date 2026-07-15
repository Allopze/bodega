/**
 * Detectar si un error capturado por un error boundary de Next.js es
 * probablemente un error de red/conexión en vez de un error de servidor.
 *
 * Útil para mostrar mensajes distintos en `error.tsx` (sección 17).
 * Next.js no expone el tipo de error de forma nativa en los boundaries,
 * así que se infiere del mensaje.
 */
export function isNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("err_connection") ||
    msg.includes("abort") ||
    msg.includes("typeerror") ||
    msg.includes("load failed")
  )
}
