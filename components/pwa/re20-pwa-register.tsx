"use client"

import { useEffect } from "react"

/** Alcance del worker RE-20: sólo el árbol de incidentes (incluye la ruta pública offline).
 *  Es subruta del directorio del script ("/re20-sw.js"), así que no requiere Service-Worker-Allowed. */
export const RE20_SW_SCOPE = "/prevencion/incidentes/"

/** Registers an isolated worker, scoped to RE-20 routes, for the offline unlock shell. */
export function Re20PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    // Versiones anteriores lo registraban con scope "/": se retira para que no siga interceptando todo el sitio.
    void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations
      .filter((registration) => registration.scope === `${location.origin}/` && registration.active?.scriptURL.endsWith("/re20-sw.js"))
      .map((registration) => registration.unregister()))).catch(() => {})
    void navigator.serviceWorker.register("/re20-sw.js", { scope: RE20_SW_SCOPE }).catch(() => {})
  }, [])
  return null
}
