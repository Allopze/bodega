import { getSession, signOut } from "next-auth/react"

/** Dónde vuelve el mecánico después de entrar con otra cuenta. */
export const MANT_LOGIN_URL = "/m/mantencion/entrar"

/** Prefijo de las cachés del service worker de la app (`public/mant-sw.js`). */
export const SHELL_CACHE_PREFIX = "mant-shell-"

/**
 * Borra el shell de la app guardado por el service worker. Sin esto, abrir la app
 * sin señal después de cerrar sesión devuelve el HTML de la sesión anterior y, en
 * una tablet compartida, el siguiente puede trabajar con la cuenta y la cola de
 * quien se fue. Tolera navegadores sin `caches` y cualquier error de almacenamiento.
 */
export async function clearShellCache(): Promise<void> {
  try {
    if (typeof caches === "undefined") return
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith(SHELL_CACHE_PREFIX)).map((key) => caches.delete(key)))
  } catch { /* sin Cache Storage no hay shell guardado que borrar */ }
}

/**
 * Cierra la sesión y manda al login propio de la app (no al de la plataforma).
 *
 * No toca la cola, los borradores ni las cuentas del dispositivo: eso vive en
 * IndexedDB (`mant-offline`) y es justamente lo que no puede perderse al cambiar
 * de persona. Sigue el mismo cuidado que `useSignOut` de la barra superior —la
 * cookie de sesión se re-emite en cada respuesta, así que se confirma contra el
 * servidor y se insiste— pero sin vaciar las colas de los demás módulos.
 */
export async function signOutToMantLogin(): Promise<void> {
  try {
    await signOut({ redirect: false })
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (!(await getSession())) break
      await signOut({ redirect: false })
    }
  } finally {
    // El shell guardado era de la sesión que se está cerrando: se borra antes de recargar.
    await clearShellCache()
    // Recarga completa: no debe sobrevivir estado en memoria de la sesión anterior.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga entera a propósito
    window.location.href = MANT_LOGIN_URL
  }
}
