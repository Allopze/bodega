"use client"

import * as React from "react"

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function"

/**
 * ¿Coincide la media query? Lee el valor en vivo y se suscribe al cambio.
 *
 * En el servidor (y en jsdom sin `matchMedia`) responde `false`, así que el primer
 * render coincide con la hidratación y la página no parpadea por una diferencia
 * entre servidor y cliente. `useReducedMotion` y `useNarrowViewport` son casos de
 * esta misma lectura.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {}
      const media = window.matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    [query],
  )
  const getSnapshot = React.useCallback(() => (hasMatchMedia() ? window.matchMedia(query).matches : false), [query])
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
