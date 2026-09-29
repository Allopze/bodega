/**
 * M-03 (auditoría de production readiness 2026-09-28): la biblioteca documental
 * servía `inline` cualquier archivo con el `Content-Type` guardado al subirlo.
 * Un `.html` o un `.svg` abierto así corre en el origen de la plataforma, con la
 * sesión de quien lo abre.
 *
 * Sólo PDF e imágenes rasterizadas se muestran en el navegador; el resto se
 * descarga, y toda respuesta de archivo lleva `nosniff` para que el navegador
 * no reinterprete el tipo.
 *
 * No se agrega una CSP propia: el proxy reescribe `Content-Security-Policy` en
 * todas las respuestas (verificado en E2E, `pdtp-evidencia-aprobacion.spec.ts`)
 * con la política de la plataforma, cuyo `script-src` por nonce ya impide que un
 * archivo mostrado en el navegador ejecute scripts. Un `sandbox` además rompería
 * el visor de PDF de Chrome.
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
} as const
