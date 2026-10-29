import { getSession, signOut } from "next-auth/react"

/** Dónde vuelve el mecánico después de entrar con otra cuenta. */
export const MANT_LOGIN_URL = "/login?callbackUrl=%2Fm%2Fmantencion"

/**
 * Cierra la sesión de la PLATAFORMA y manda al login con retorno a la app.
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
    // Recarga completa: no debe sobrevivir estado en memoria de la sesión anterior.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga entera a propósito
    window.location.href = MANT_LOGIN_URL
  }
}
