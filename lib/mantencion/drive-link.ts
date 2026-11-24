/**
 * Enlace de Google Drive/Docs apto para un `href`, o `null`.
 *
 * Los enlaces del historial de mantención (fotos de filtros y sticker, hojas del consolidado)
 * vienen de una celda de Excel, es decir, de texto libre. Sólo se acepta `https:` hacia los
 * hosts de Google: `javascript:`, `data:`, `http:`, hosts ajenos y texto que no es una URL se
 * descartan. Es una función pura (sin base de datos) para poder usarla también en componentes
 * de cliente. Se valida al mostrar, no al importar: el valor original se conserva tal cual
 * para la trazabilidad y cualquier otro escritor de la base queda cubierto.
 */
const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"])

export function driveLink(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && DRIVE_HOSTS.has(url.hostname) ? url.href : null
  } catch {
    return null
  }
}
