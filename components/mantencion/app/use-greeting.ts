"use client"

import { useSyncExternalStore } from "react"
import { greetingForChileHour } from "@/lib/utils"

/** El saludo sólo cambia al cruzar una hora; con revisar cada minuto sobra. */
function subscribe(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000)
  return () => window.clearInterval(timer)
}

/**
 * Saludo según la hora de Chile ("Buenos días", "Buenas tardes", "Buenas
 * noches") para las pantallas de la app del mecánico.
 *
 * Son componentes cliente que también se pintan en el servidor y sin conexión,
 * y la hora del servidor no es la del teléfono: calcularlo en el render
 * produciría un desajuste de hidratación. `useSyncExternalStore` entrega "Hola"
 * en el render del servidor/de hidratación y el saludo real en cuanto monta, y
 * lo mantiene al día si la pantalla queda abierta al cruzar una hora.
 */
export function useGreeting(): string {
  return useSyncExternalStore(subscribe, () => greetingForChileHour(), () => "Hola")
}
