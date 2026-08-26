"use client"

import * as React from "react"

/**
 * Estado persistido en localStorage con hidratación segura: el valor se lee
 * en un efecto (no en el initializer de `useState`) para que SSR y el primer
 * render cliente coincidan, y las lecturas/escrituras fallan silenciosamente
 * (localStorage puede no estar disponible).
 *
 * - `parse`: convierte el string guardado en `T`; devolver `null` lo descarta.
 * - `serialize`: convierte `T` de vuelta a string (default `String(next)`).
 *
 * Antes cada pantalla reimplementaba este patrón (densidad y ventana de meses
 * del PDTP, modo de vista de documentación) con sus propias claves y checks.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  parse: (stored: string) => T | null,
  serialize: (next: T) => string = (next) => String(next),
): [T, (next: T) => void] {
  const [value, setValue] = React.useState<T>(defaultValue)

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored == null) return
      const next = parse(stored)
      if (next != null) setValue(next)
    } catch {}
  }, [key, parse])

  const set = React.useCallback(
    (next: T) => {
      setValue(next)
      try { localStorage.setItem(key, serialize(next)) } catch {}
    },
    [key, serialize],
  )

  return [value, set]
}
