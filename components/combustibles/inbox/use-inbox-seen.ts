"use client"

import * as React from "react"

/**
 * Lo nuevo de la bandeja queda marcado con un punto hasta que la persona lo
 * abre (interacción tomada del tablero de embarque en la propuesta).
 *
 * «Nuevo» es lo que llegó después de la primera visita de esta persona en este
 * navegador y que todavía no abrió: el primer día no se marca todo. Se guarda
 * en el navegador porque es una comodidad de lectura, no un estado del negocio;
 * si se pierde, sólo vuelve a empezar desde la visita siguiente.
 */
const MAX_KEYS = 500

interface SeenState {
  since: string
  keys: string[]
}

function storageKey(userId: string): string {
  return `chome:fuel-inbox-seen:${userId}`
}

function read(userId: string): SeenState {
  const fresh = { since: new Date().toISOString(), keys: [] }
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    const parsed = raw ? (JSON.parse(raw) as Partial<SeenState>) : null
    if (!parsed || typeof parsed.since !== "string" || !Array.isArray(parsed.keys)) {
      window.localStorage.setItem(storageKey(userId), JSON.stringify(fresh))
      return fresh
    }
    return { since: parsed.since, keys: parsed.keys.filter((value): value is string => typeof value === "string") }
  } catch {
    return fresh
  }
}

export function useInboxSeen(userId: string) {
  const [state, setState] = React.useState<SeenState | null>(null)
  React.useEffect(() => { setState(read(userId)) }, [userId])

  const markSeen = React.useCallback((key: string) => {
    setState((current) => {
      if (!current || current.keys.includes(key)) return current
      const next = { since: current.since, keys: [...current.keys, key].slice(-MAX_KEYS) }
      try { window.localStorage.setItem(storageKey(userId), JSON.stringify(next)) } catch { /* sin almacenamiento: el punto vuelve */ }
      return next
    })
  }, [userId])

  /** Antes de leer el almacenamiento no se marca nada, para que el punto no parpadee al hidratar. */
  const isNew = React.useCallback(
    (key: string, waitingSince: string) => state !== null && waitingSince > state.since && !state.keys.includes(key),
    [state],
  )

  return { isNew, markSeen }
}
