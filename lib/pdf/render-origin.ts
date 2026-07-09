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
