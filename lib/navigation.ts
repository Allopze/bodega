export function safeInternalPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value) return fallback

  try {
    const decoded = decodeURIComponent(value)
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return fallback
    if (/[\r\n]/.test(decoded)) return fallback
    return decoded
  } catch {
    return fallback
  }
}
