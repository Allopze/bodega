"use client"

import { useMediaQuery } from "@/lib/hooks/use-media-query"

const QUERY = "(prefers-reduced-motion: reduce)"

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
  return useMediaQuery(QUERY)
}
