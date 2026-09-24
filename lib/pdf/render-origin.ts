function readRuntimeEnv(name: string) {
  const value = process.env[name]?.trim()
  return value || undefined
}

function stripTrailingSlash(origin: string) {
  return origin.replace(/\/+$/, "")
}

export function resolvePdfRenderOrigin(req: Request) {
  const internalOrigin = readRuntimeEnv("PDF_RENDER_ORIGIN")
  if (internalOrigin) return stripTrailingSlash(internalOrigin)

  const configuredOrigin = readRuntimeEnv("APP_URL") ?? new URL(req.url).origin
  const originUrl = new URL(configuredOrigin)

  if (originUrl.hostname === "0.0.0.0") {
    originUrl.hostname = "127.0.0.1"
    originUrl.protocol = "http:"
  }

  return stripTrailingSlash(originUrl.origin)
}

/**
 * Origen para imprimir fuera de una ruta de descarga (el archivado de
 * documentos generados corre en un `after()` o en el cron, sin `Request`).
 *
 * Solo del entorno: nunca del header Host, que el cliente controla. Con él, un
 * `Host` forjado mandaría la cookie de sesión que se reenvía al navegador sin
 * interfaz a un servidor ajeno. Sin `PDF_RENDER_ORIGIN` ni `APP_URL`, lanza.
 */
export function resolveInternalRenderOrigin(): string {
  const configured = readRuntimeEnv("PDF_RENDER_ORIGIN") ?? readRuntimeEnv("APP_URL")
  if (!configured) throw new Error("PDF_ORIGIN_NOT_CONFIGURED")
  const originUrl = new URL(configured)
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new Error("PDF_ORIGIN_NOT_CONFIGURED")
  }
  if (originUrl.hostname === "0.0.0.0") {
    originUrl.hostname = "127.0.0.1"
    originUrl.protocol = "http:"
  }
  return stripTrailingSlash(originUrl.origin)
}
