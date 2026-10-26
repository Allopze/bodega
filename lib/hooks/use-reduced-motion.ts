"use client"

import * as React from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function getSnapshot() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia(QUERY).matches
}

/**
 * ¿El usuario pidió reducir el movimiento?
 *
 * Los tokens `--duration-*` de `globals.css` ya caen a 0 ms bajo esa
 * preferencia, pero recharts anima por JS y no los lee: sus gráficos necesitan
 * este valor para apagar `isAnimationActive`. En el servidor (y en jsdom sin
 * `matchMedia`) responde `false`, así que el primer render coincide con la
 * hidratación.
 */
export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
