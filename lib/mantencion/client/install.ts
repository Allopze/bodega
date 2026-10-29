/**
 * Invitación a instalar la app del mecánico en el teléfono.
 *
 * - Android/Chrome (y Edge, Samsung Internet): el navegador avisa con
 *   `beforeinstallprompt` que la app es instalable; se guarda ese evento y la
 *   app ofrece «Instalar app», que abre el diálogo nativo.
 * - iPhone/iPad (Safari): no hay evento ni diálogo; sólo se puede «Compartir →
 *   Agregar a inicio», así que la app muestra esos pasos.
 * - Android sin evento (Firefox, o Chrome antes de considerarla instalable): los
 *   pasos del menú del navegador.
 * - Ya instalada (abierta desde la pantalla de inicio): no se muestra nada.
 *
 * El evento suele llegar antes de que React monte, por eso se escucha desde que
 * este módulo se carga y se guarda en una variable de módulo.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallPlatform = "ios" | "android" | "other"
export type InstallMode = "hidden" | "prompt" | "ios" | "android-manual"

/** Cuánto se calla la invitación después de «Ahora no». */
export const INSTALL_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000
const SNOOZE_KEY = "mant-install-snoozed-at"

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Sin esto el navegador muestra su propia barra y el evento ya no sirve después.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    installed = true
    notify()
  })
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Instantánea para `useSyncExternalStore`: cambia cuando llega o se usa el evento. */
export function installSnapshot(): string {
  return `${deferred ? "prompt" : "none"}:${installed ? "installed" : "web"}`
}

export function hasDeferredPrompt(): boolean {
  return deferred !== null
}

/**
 * Abre el diálogo nativo. El evento sirve una sola vez: después de usarlo (se
 * acepte o no) se descarta, y el navegador puede volver a ofrecerlo más tarde.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred
  if (!event) return "unavailable"
  deferred = null
  notify()
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === "accepted") { installed = true; notify() }
    return choice.outcome
  } catch {
    return "unavailable"
  }
}

export function detectPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios"
  // iPadOS se presenta como Mac de escritorio; se delata por la pantalla táctil.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios"
  if (/Android/i.test(userAgent)) return "android"
  return "other"
}

/** Abierta como app instalada (pantalla completa, sin barra del navegador). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia?.(`(display-mode: ${mode})`)?.matches === true)
}

/** Regla pura de qué mostrar. */
export function installMode(input: {
  standalone: boolean
  installed: boolean
  platform: InstallPlatform
  hasPrompt: boolean
  snoozedAt: number | null
  now: number
}): InstallMode {
  if (input.standalone || input.installed) return "hidden"
  if (input.snoozedAt !== null && input.now - input.snoozedAt < INSTALL_SNOOZE_MS) return "hidden"
  if (input.hasPrompt) return "prompt"
  if (input.platform === "ios") return "ios"
  if (input.platform === "android") return "android-manual"
  // Escritorio sin evento (p. ej. jefatura probando la app): no hay nada útil que ofrecer.
  return "hidden"
}

export function isInstalledFlag(): boolean {
  return installed
}

export function readSnooze(): number | null {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function writeSnooze(at: number): void {
  try { window.localStorage.setItem(SNOOZE_KEY, String(at)) } catch { /* sin almacenamiento: se vuelve a ofrecer */ }
}
