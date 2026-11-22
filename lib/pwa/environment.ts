/**
 * lib/pwa/environment.ts — Dónde corre una app del teléfono.
 *
 * Lo comparten la app del mecánico, PPA y TAE (el aviso de estado y el aviso de
 * instalación). Vivía en `lib/mantencion/client/`; esos archivos lo reexportan
 * para no tocar a quien ya lo importaba desde ahí.
 */

/** Abierta como app instalada (pantalla completa, sin barra del navegador). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia?.(`(display-mode: ${mode})`)?.matches === true)
}

/** Rótulo corto del teléfono, «Android · Chrome». */
export function deviceLabel(userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const system = /iPad/.test(userAgent) ? "iPad" : /iPhone/.test(userAgent) ? "iPhone" : /Android/.test(userAgent) ? "Android" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "Mac" : "Dispositivo"
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "navegador"
  return `${system} · ${browser}`
}
