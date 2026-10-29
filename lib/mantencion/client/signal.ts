import { emit } from "./events"
import { getMeta, setMeta } from "./meta"

/**
 * Señal del teléfono. Una sola verdad para toda la app: el navegador dice si hay
 * red (`navigator.onLine`) y los envíos dicen si la plataforma realmente
 * responde (un wifi sin salida a internet marca «en línea» y no lo está).
 *
 * `offlineSince` se guarda en IndexedDB: sobrevive a una recarga y viaja en cada
 * registro firmado sin señal, para que jefatura sepa desde cuándo estaba aislado
 * el teléfono (regla 8, hora del sello vs. hora de recepción).
 */

let browserOnline = typeof navigator === "undefined" || navigator.onLine !== false
let unreachable = false
let offlineSince: string | null = null
let started = false

export function isOnline(): boolean {
  return browserOnline && !unreachable
}

/** ISO de cuando se perdió la señal; `null` con señal. Lectura inmediata (memoria). */
export function getOfflineSince(): string | null {
  return isOnline() ? null : offlineSince
}

async function reconcile(): Promise<void> {
  if (isOnline()) {
    if (offlineSince !== null) {
      offlineSince = null
      try { await setMeta("offlineSince", null) } catch { /* sin almacenamiento: sólo se pierde el dato */ }
    }
  } else if (offlineSince === null) {
    offlineSince = new Date().toISOString()
    try { await setMeta("offlineSince", offlineSince) } catch { /* idem */ }
  }
  emit("signal")
}

/** Los envíos informan si la plataforma contestó (`true`) o ni siquiera hubo respuesta de red (`false`). */
export function reportReachable(reachable: boolean): void {
  const next = !reachable
  if (next === unreachable) return
  unreachable = next
  void reconcile()
}

/** Engancha `online`/`offline`; devuelve la función que los suelta. Idempotente por llamada. */
export function startSignalTracking(): () => void {
  if (typeof window === "undefined") return () => {}
  const update = () => {
    browserOnline = navigator.onLine !== false
    if (browserOnline === false) unreachable = false
    void reconcile()
  }
  window.addEventListener("online", update)
  window.addEventListener("offline", update)
  if (!started) {
    started = true
    void (async () => {
      // Si el teléfono arrancó sin señal, el dato guardado puede venir de antes de cerrar la app; se conserva.
      try { offlineSince = (await getMeta("offlineSince")) ?? null } catch { offlineSince = null }
      browserOnline = navigator.onLine !== false
      await reconcile()
    })()
  } else {
    update()
  }
  return () => {
    window.removeEventListener("online", update)
    window.removeEventListener("offline", update)
  }
}

/** Sólo para pruebas. */
export function resetSignalForTests(): void {
  browserOnline = true
  unreachable = false
  offlineSince = null
  started = false
}
