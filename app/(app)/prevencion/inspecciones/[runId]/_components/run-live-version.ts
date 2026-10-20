"use client"

import * as React from "react"

/**
 * La versión vigente de la inspección, compartida entre dos árboles que no se
 * tocan: el detalle (donde vive el canal de guardado, que la avanza con cada
 * guardado) y las acciones del registro (Acta PDF, Reabrir, Cancelar), que la
 * página las entrega al encabezado de la shell y por tanto cuelgan de otro
 * lugar del árbol.
 *
 * Sin esto, «Cancelar inspección» mandaría la versión de las props de la
 * página, que va un paso atrás mientras un guardado está en vuelo, y el
 * servidor la rechazaría como conflicto contra el propio autoguardado.
 *
 * Sólo sube (`max`): una versión más vieja nunca gana, igual que en el canal.
 */
const versions = new Map<string, number>()
const listeners = new Set<() => void>()

export function publishRunVersion(runId: string, version: number) {
  if (version <= (versions.get(runId) ?? -1)) return
  versions.set(runId, version)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** La mayor entre la de las props (`fallback`) y la última publicada para esta inspección. */
export function useLiveRunVersion(runId: string, fallback: number): number {
  const live = React.useSyncExternalStore(
    subscribe,
    () => versions.get(runId) ?? 0,
    () => 0,
  )
  return Math.max(fallback, live)
}

/** Sólo para pruebas: el módulo es un singleton por pestaña. */
export function resetRunVersionsForTests() {
  versions.clear()
}
