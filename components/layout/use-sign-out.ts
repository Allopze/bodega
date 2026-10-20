"use client"

import * as React from "react"
import { getSession, signOut } from "next-auth/react"
import { clearAllInspectionDrafts } from "@/lib/prevention/inspection-draft-storage"

/**
 * Bloquea la bóveda RE-20 cifrada (conserva sus borradores) y vacía las colas
 * en claro: la antigua de incidentes, PPA e inspecciones. Import dinámico para no cargar IndexedDB ni el
 * árbol de Prevención en el bundle de la barra superior.
 */
async function clearOfflineQueues() {
  try {
    const [{ lockAndPurgeIncidentQueues }, { clearPpaQueue }, { clearInspectionSubmissionQueue }] = await Promise.all([
      import("@/app/(app)/prevencion/incidentes/reportar/offline-incident-queue"),
      import("@/lib/pwa/offline-queue"),
      // Las respuestas de una inspección y los nombres de quienes firman el
      // acta viven en claro en IndexedDB hasta 30 días, en equipos compartidos.
      import("@/app/(app)/prevencion/inspecciones/[runId]/offline-inspection-queue"),
    ])
    await Promise.allSettled([lockAndPurgeIncidentQueues(), clearPpaQueue(), clearInspectionSubmissionQueue()])
  } catch {
    /* no-op: cerrar sesión nunca se bloquea por la limpieza local */
  }
}

/**
 * Vacía el espejo local de las inspecciones en curso (`localStorage`). Es
 * síncrono, sin dependencias y no lanza, así que va estático y fuera de
 * `clearOfflineQueues`: que un import dinámico de esas colas falle no puede
 * dejar las respuestas de un inspector en un equipo de faena compartido.
 */
function clearLocalInspectionDrafts() {
  try {
    clearAllInspectionDrafts()
  } catch {
    /* no-op: cerrar sesión nunca se bloquea por la limpieza local */
  }
}

/**
 * Cierre de sesión compartido por la barra superior y el perfil del panel
 * lateral.
 *
 * Dos garantías, aprendidas de sendos fallos reales:
 *
 * 1. **La navegación va en `finally`.** Con `await signOut(...)` suelto,
 *    cualquier fallo de esa llamada dejaba al usuario exactamente donde estaba:
 *    en una pantalla autenticada, después de haber pulsado "Cerrar sesión", sin
 *    ningún aviso de que no había salido.
 *
 * 2. **No se da por hecho que surtió efecto.** La sesión es un JWT en cookie y
 *    `signOut({ redirect: false })` puede resolver sin que la cookie llegue a
 *    invalidarse; entonces `/login` reconoce la sesión viva y devuelve al panel,
 *    de modo que el usuario ve su cuenta abierta tras haber cerrado sesión. Se
 *    confirma contra el servidor y se reintenta una vez antes de salir.
 *
 * Salir siempre hacia `/login` es lo seguro: si pese a todo la cookie sobrevive,
 * la pantalla de acceso lo resolverá; nunca se deja al usuario dentro.
 */
export function useSignOut() {
  const [isSigningOut, setIsSigningOut] = React.useState(false)

  const handleSignOut = React.useCallback(async () => {
    setIsSigningOut(true)
    try {
      // La bóveda RE-20 usa una frase local distinta de la sesión: se bloquea y
      // conserva sus borradores cifrados. Lo que vive en claro (cola antigua de
      // incidentes, PPA, inspecciones) no puede sobrevivir al cambio de usuario
      // en un equipo de faena compartido. Best-effort: no bloquea el cierre.
      clearLocalInspectionDrafts()
      await clearOfflineQueues()
      await signOut({ redirect: false })
      // Tercera lección (2026-08-06): el middleware re-emite la cookie de
      // sesión (JWT rolling) en CADA respuesta, y las páginas con muchos
      // prefetches en vuelo (el tablero prefetchea todas sus vistas) la
      // RESUCITAN después del signout — el reintento único también perdía esa
      // carrera. Se insiste con un respiro entre intentos hasta que la
      // tormenta de respuestas pase y la sesión esté muerta de verdad;
      // getSession() con sesión ya limpia no re-emite nada.
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        if (!(await getSession())) break
        await signOut({ redirect: false })
      }
    } finally {
      window.location.href = "/login"
    }
  }, [])

  return { isSigningOut, handleSignOut }
}
