"use client"

/**
 * lib/pwa/use-online-status.ts
 *
 * Conectividad del navegador como hook. Vive aparte de `hooks.ts` para que una
 * pantalla que sólo necesita saber si hay señal (el detalle de una inspección)
 * no arrastre la cola offline del PPA, su validación y las notificaciones.
 * `hooks.ts` lo reexporta: los consumidores existentes no cambian.
 */

import * as React from "react"

function subscribeOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange)
  window.addEventListener("offline", onStoreChange)
  return () => {
    window.removeEventListener("online", onStoreChange)
    window.removeEventListener("offline", onStoreChange)
  }
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine
}

/**
 * En el servidor no hay conectividad que medir. NO se puede preguntar por
 * `navigator`: desde Node 22 el runtime global expone un objeto `navigator` sin
 * `onLine`, así que un guard `typeof navigator !== "undefined"` daba por bueno
 * el entorno del servidor y leía `undefined` (falsy) — el servidor renderizaba
 * el aviso "Sin conexión" y el navegador, con `navigator.onLine === true`, el
 * formulario, dejando React #418 de hidratación en cada carga de /ppa.
 */
function getServerOnlineSnapshot(): boolean {
  return true
}

export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribeOnlineStatus, getOnlineSnapshot, getServerOnlineSnapshot)
}
