/**
 * M-03 (auditoría de production readiness 2026-09-28): la biblioteca documental
 * servía `inline` cualquier archivo con el `Content-Type` guardado al subirlo.
 * Un `.html` o un `.svg` abierto así corre en el origen de la plataforma, con la
 * sesión de quien lo abre.
 *
 * Sólo PDF e imágenes rasterizadas se muestran en el navegador; el resto se
 * descarga. Y toda respuesta de archivo lleva `nosniff` y una CSP `sandbox`, que
 * aísla el documento aunque el navegador decida mostrarlo.
 */
const INLINE_SAFE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

export function isInlineSafeMime(mimeType: string | null | undefined): boolean {
  const base = mimeType?.split(";")[0]?.trim().toLowerCase()
  return !!base && INLINE_SAFE_MIME.has(base)
}

export function fileDisposition(mimeType: string | null | undefined, wantsDownload: boolean): "inline" | "attachment" {
  return !wantsDownload && isInlineSafeMime(mimeType) ? "inline" : "attachment"
}

export const UNTRUSTED_FILE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox",
} as const
