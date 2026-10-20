"use client"

import * as React from "react"

export type GeoState = "idle" | "pending" | "denied"

export interface GeoCoords {
  lat: string
  lon: string
}

/**
 * Captura de la ubicación del equipo (función #8). La ubicación es un dato de
 * apoyo: si el navegador no la entrega o la persona la niega, la inspección se
 * registra igual y sólo se avisa, nunca se bloquea.
 *
 * `onPosition` recibe las coordenadas con seis decimales. Se lee desde un ref:
 * quien llama no necesita memoizarla.
 */
export function useGeolocation(onPosition: (coords: GeoCoords) => void) {
  const [state, setState] = React.useState<GeoState>("idle")
  const onPositionRef = React.useRef(onPosition)
  React.useEffect(() => {
    onPositionRef.current = onPosition
  })
  // Una respuesta que llega con la pantalla ya desmontada no debe tocar el estado.
  const mountedRef = React.useRef(false)
  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const capture = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("denied")
      return
    }
    setState("pending")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!mountedRef.current) return
        onPositionRef.current({
          lat: position.coords.latitude.toFixed(6),
          lon: position.coords.longitude.toFixed(6),
        })
        setState("idle")
      },
      // Degradación silenciosa: la ubicación es un dato de apoyo, nunca un
      // bloqueo para registrar la inspección.
      () => { if (mountedRef.current) setState("denied") },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }, [])

  return { state, capture }
}
