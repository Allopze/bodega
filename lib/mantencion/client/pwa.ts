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
    // No `navigator.serviceWorker.ready`: tras el login la app llega con navegación del lado del
    // cliente y el documento nació en `/login`, fuera del alcance; `ready` no resuelve nunca y la
    // precarga no se pedía, así que el primer arranque sin señal no tenía los archivos de Next.
    const worker = await activatedWorker(registration)
    worker?.postMessage({ type: "precache", urls: loadedStaticUrls() })
    return registration
  } catch {
    return null
  }
}

/** El worker activo del registro, esperando a que termine de instalarse (con tope). */
function activatedWorker(registration: ServiceWorkerRegistration, timeoutMs = 30_000): Promise<ServiceWorker | null> {
  if (registration.active) return Promise.resolve(registration.active)
  const pending = registration.installing ?? registration.waiting
  if (!pending) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(registration.active), timeoutMs)
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") { clearTimeout(timer); resolve(pending) }
      if (pending.state === "redundant") { clearTimeout(timer); resolve(registration.active) }
    })
  })
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
    // Por el registro y no por `ready`, por la misma razón que arriba.
    const registration = (await navigator.serviceWorker.getRegistration(SW_SCOPE)) as SyncCapableRegistration | undefined
    await registration?.sync?.register("mant-sync")
  } catch { /* sin Background Sync */ }
}
