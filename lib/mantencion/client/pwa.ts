/**
 * Puesta en marcha de la PWA: service worker con alcance `/m/mantencion`, pedido
 * de almacenamiento persistente (para que el sistema no vacíe las fotos cuando
 * falta espacio) y Background Sync, donde exista.
 */

export const SW_URL = "/mant-sw.js"
export const SW_SCOPE = "/m/mantencion"

type SyncCapableRegistration = ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }

/** Archivos versionados que la página ya cargó: el worker los guarda para el primer arranque sin señal. */
function loadedStaticUrls(): string[] {
  return performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).pathname.startsWith("/_next/static/"))
}

export async function registerMantServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null
  // En desarrollo los archivos de `/_next/static/` cambian sin cambiar de nombre: un worker que los guarda
  // (cache-first) serviría código viejo. Sólo se instala en producción y, en desarrollo, se retira el que haya.
  if (process.env.NODE_ENV !== "production") {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.filter((entry) => entry.active?.scriptURL.endsWith(SW_URL)).map((entry) => entry.unregister()))
    } catch { /* nada que retirar */ }
    return null
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
    const ready = await navigator.serviceWorker.ready
    ready.active?.postMessage({ type: "precache", urls: loadedStaticUrls() })
    return registration
  } catch {
    return null
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** Pide al sistema que despierte la app cuando vuelva la señal. Mejor esfuerzo: si no existe, el sondeo de 60 s cubre. */
export async function registerBackgroundSync(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return
    const registration = (await navigator.serviceWorker.ready) as SyncCapableRegistration
    await registration.sync?.register("mant-sync")
  } catch { /* sin Background Sync */ }
}
