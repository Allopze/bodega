/**
 * Proveedor del mapa base (MapLibre) y su worker.
 *
 * Lo comparten el componente del mapa y la CSP: si el estilo cambia de
 * proveedor y la CSP no se entera, `connect-src` bloquea el estilo, el mapa
 * nunca emite `load` y queda un rectángulo en blanco (así estuvo
 * `/flota/monitoreo` en producción hasta 2026-11-09).
 */

/** Estilo por defecto fuera de producción. */
export const DEVELOPMENT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"

/**
 * URL del estilo, o `null` si producción no tiene proveedor configurado.
 * `process.env.NEXT_PUBLIC_*` se lee literal para que Next lo incruste en el
 * bundle del navegador.
 */
export function resolveMapStyleUrl(
  configured: string | undefined = process.env.NEXT_PUBLIC_MAP_STYLE_URL,
  isProduction: boolean = process.env.NODE_ENV === "production",
): string | null {
  const url = configured?.trim()
  if (url) return url
  return isProduction ? null : DEVELOPMENT_MAP_STYLE_URL
}

/**
 * Origen que la CSP debe abrir en `connect-src` para el estilo. Cubre a los
 * proveedores que sirven estilo, tiles, glifos y sprites desde un mismo origen
 * (OpenFreeMap lo hace); uno que reparta recursos en otros orígenes exige
 * agregarlos aquí.
 */
export function mapStyleConnectSrcOrigin(styleUrl: string | null): string | null {
  if (!styleUrl) return null
  try {
    const url = new URL(styleUrl)
    return url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

/** Archivos de `maplibre-gl/dist` que forman el worker (el worker importa el compartido). */
export const MAPLIBRE_WORKER_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"] as const

/**
 * URL del worker en el mismo origen. MapLibre 6 la deduce de `import.meta.url`,
 * pero webpack la reemplaza por `file:///…/maplibre-gl.mjs`: sin esta URL el
 * worker intenta cargar la página HTML como módulo y el mapa nunca dibuja.
 */
export function maplibreWorkerUrl(version: string): string {
  return `/vendor/maplibre/${encodeURIComponent(version)}/${MAPLIBRE_WORKER_FILES[0]}`
}
