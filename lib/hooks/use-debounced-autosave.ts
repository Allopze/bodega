"use client"

import * as React from "react"
import type { ActionState } from "@/lib/validation/operations"

export type AutosaveStatus = "saved" | "saving" | "dirty" | "error"

/** Tope de la espera entre reintentos tras un fallo transitorio. */
const MAX_BACKOFF_MS = 30_000

const NETWORK_MESSAGE = "Error de red al guardar. Se reintentará automáticamente."

/**
 * Por qué no se pudo guardar. `transient` dice si el hook va a reintentar solo
 * (red caída, la Server Action ni siquiera respondió); un rechazo permanente
 * espera a que cambie `watchKey` o a un `saveNow` explícito.
 */
export interface AutosaveFailure {
  transient: boolean
  message: string
  /** Lo que devolvió la acción; `null` si `onSave` lanzó una excepción (no hubo respuesta). */
  result: ActionState | null
  /** El navegador declaraba no tener conexión al fallar. */
  offline: boolean
}

export interface UseDebouncedAutosaveOptions {
  watchKey: string | number
  isDirty: boolean
  onSave: () => Promise<ActionState>
  /** Se invoca tras un guardado exitoso, con el resultado. Pensado para UIs
   *  que muestran "Guardado HH:MM" o refrescan datos derivados. */
  onSaved?: (result: ActionState) => void
  enabled?: boolean
  debounceMs?: number
  /**
   * ¿Un `ok: false` se arregla reintentando? Por defecto no: un rechazo del
   * servidor (validación, conflicto de versión, estado) da el mismo rechazo
   * al repetir el mismo envío, y reintentarlo en bucle sólo gasta red. Las
   * excepciones de `onSave` (sin respuesta) SIEMPRE son transitorias.
   */
  isTransient?: (result: ActionState) => boolean
  /** Se invoca en cada guardado fallido, con su clasificación. */
  onFailed?: (failure: AutosaveFailure) => void
  /**
   * Gobierna el aviso de `beforeunload`. Por defecto `enabled && isDirty`.
   * Pasarlo explícito lo desliga de `enabled`: pausar el autoguardado (en un
   * conflicto, mientras se cierra) no debe dejar salir de la página con trabajo
   * sin enviar sin avisar.
   */
  hasUnsavedWork?: boolean
}

export interface UseDebouncedAutosaveResult {
  status: AutosaveStatus
  /** Mensaje del último fallo vigente; no se limpia al reintentar, sólo al guardar. */
  error: string | null
  /** El último fallo vigente (`null` si no hay o ya no hay nada sin guardar). */
  failure: AutosaveFailure | null
  /** Hay un fallo transitorio y lo sin guardar se reintentará solo. */
  retrying: boolean
  /**
   * Guarda ya, saltándose el debounce y aunque el autoguardado esté pausado
   * (`enabled: false`). Espera lo que esté en vuelo y, si sigue habiendo
   * cambios, guarda. DEVUELVE el resultado, y no lanza nunca (una excepción de
   * `onSave` vuelve como `{ ok: false }`). `null` = no había nada que guardar.
   * Si lo que estaba en vuelo falló, devuelve ese fallo sin repetirlo.
   */
  saveNow: () => Promise<ActionState | null>
  /**
   * Como `saveNow`, pero repite hasta que no quede nada sin guardar (si la
   * persona siguió editando durante el envío), y se detiene ante el primer
   * fallo devolviéndolo. Para «guardar antes de cerrar».
   */
  flush: () => Promise<ActionState | null>
}

interface Outcome {
  /** `watchKey` con el que se hizo el intento. */
  key: string | number
  kind: "ok" | "transient" | "permanent"
  /** Fallos transitorios seguidos con esa misma clave (para el backoff). */
  failures: number
}

function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/**
 * Guarda automáticamente tras una pausa de tecleo, reusando la misma Server
 * Action que un botón explícito. No agenda un nuevo intento mientras el
 * anterior sigue en vuelo y advierte con `beforeunload` si queda algo sin
 * guardar. Generaliza el patrón introducido en `MetadataTab`
 * (app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx).
 *
 * `watchKey` debe cambiar (por valor, no por referencia) cada vez que el
 * campo vigilado cambia — un string/number derivado de los campos, o el
 * propio valor si es primitivo. `onSave` puede cambiar de identidad en cada
 * render sin romper el debounce: se lee desde un ref, no desde la deps del
 * efecto, así el caller no necesita memoizarla con `useCallback`.
 *
 * Qué hace tras un intento, con la clave `watchKey` con la que se hizo:
 * - **Éxito o rechazo permanente:** no vuelve a armar el temporizador mientras
 *   `watchKey` siga igual, aunque `isDirty` quede en true. Antes se rearmaba en
 *   cuanto `pending` volvía a false, así que un rechazo (o un `isDirty` que no
 *   se apaga) guardaba en bucle cada 1,5 s para siempre.
 * - **Fallo transitorio** (excepción, o `isTransient`): reintenta tras
 *   `min(debounceMs · 2^n, 30 s)` (n = fallos seguidos, desde 0), y al volver
 *   la señal (`online`) reintenta de inmediato.
 * - **`watchKey` nuevo:** reinicia el backoff y vuelve al debounce normal.
 *
 * Retrocompatible: todo lo nuevo (`isTransient`, `onFailed`, `hasUnsavedWork`,
 * `flush`, `failure`, `retrying`) es opcional.
 */
export function useDebouncedAutosave({
  watchKey,
  isDirty,
  onSave,
  onSaved,
  enabled = true,
  debounceMs = 1500,
  isTransient,
  onFailed,
  hasUnsavedWork,
}: UseDebouncedAutosaveOptions): UseDebouncedAutosaveResult {
  const [pending, setPending] = React.useState(false)
  const [failureState, setFailureState] = React.useState<AutosaveFailure | null>(null)
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)

  const onSaveRef = React.useRef(onSave)
  const onSavedRef = React.useRef(onSaved)
  const onFailedRef = React.useRef(onFailed)
  const isTransientRef = React.useRef(isTransient)
  const watchKeyRef = React.useRef(watchKey)
  const isDirtyRef = React.useRef(isDirty)
  const enabledRef = React.useRef(enabled)
  React.useEffect(() => {
    onSaveRef.current = onSave
    onSavedRef.current = onSaved
    onFailedRef.current = onFailed
    isTransientRef.current = isTransient
    watchKeyRef.current = watchKey
    isDirtyRef.current = isDirty
    enabledRef.current = enabled
  })

  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const outcomeRef = React.useRef<Outcome | null>(null)
  const inFlightRef = React.useRef<{ promise: Promise<ActionState>; key: string | number } | null>(null)

  const clearTimer = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const runSave = React.useCallback((): Promise<ActionState> => {
    // Un solo guardado a la vez: quien llega con uno en vuelo comparte su resultado.
    if (inFlightRef.current) return inFlightRef.current.promise
    const key = watchKeyRef.current

    const attempt = async (): Promise<ActionState> => {
      setPending(true)
      let result: ActionState
      let thrown = false
      try {
        result = await onSaveRef.current()
      } catch {
        // Falla de red u otra excepción no controlada (no la Server Action
        // devolviendo ok:false, sino que ni siquiera respondió). Es el caso
        // típico de terreno sin señal: se reintenta con backoff y, mientras
        // tanto, el error sigue a la vista en vez de parpadear en cada ciclo.
        thrown = true
        result = { ok: false, message: NETWORK_MESSAGE }
      }

      const previous = outcomeRef.current
      let next: Outcome
      let failure: AutosaveFailure | null = null
      if (result.ok) {
        next = { key, kind: "ok", failures: 0 }
      } else {
        const transient = thrown || (isTransientRef.current?.(result) ?? false)
        failure = {
          transient,
          message: result.message ?? "Error al guardar.",
          result: thrown ? null : result,
          offline: browserIsOffline(),
        }
        next = transient
          ? { key, kind: "transient", failures: (previous?.kind === "transient" && previous.key === key ? previous.failures : 0) + 1 }
          : { key, kind: "permanent", failures: 0 }
      }
      outcomeRef.current = next
      setOutcome(next)
      setFailureState(failure)
      setPending(false)
      if (failure) onFailedRef.current?.(failure)
      else onSavedRef.current?.(result)
      return result
    }

    const promise = attempt()
    const flight = { promise, key }
    inFlightRef.current = flight
    // `attempt` no rechaza (las excepciones de `onSave` se absorben arriba); si
    // `onSaved`/`onFailed` lanzaran, la limpieza igual debe ocurrir.
    const clear = () => { if (inFlightRef.current === flight) inFlightRef.current = null }
    promise.then(clear, clear)
    return promise
  }, [])

  React.useEffect(() => {
    if (!enabled || !isDirty || pending) return
    let delay = debounceMs
    if (outcome && outcome.key === watchKey) {
      // Ya se intentó con esta misma clave: sólo un fallo transitorio se
      // vuelve a intentar solo. Tras un éxito o un rechazo permanente, esperar
      // a que la persona cambie algo (o a un guardado explícito).
      if (outcome.kind !== "transient") return
      delay = Math.min(debounceMs * 2 ** (outcome.failures - 1), MAX_BACKOFF_MS)
    }
    const id = setTimeout(() => { void runSave() }, delay)
    timeoutRef.current = id
    return () => clearTimeout(id)
  }, [watchKey, isDirty, enabled, pending, debounceMs, outcome, runSave])

  // Al volver la señal no hay por qué esperar el resto del backoff.
  React.useEffect(() => {
    function retryOnReconnect() {
      if (!enabledRef.current || !isDirtyRef.current || inFlightRef.current) return
      const last = outcomeRef.current
      if (!last || last.kind !== "transient" || last.key !== watchKeyRef.current) return
      clearTimer()
      void runSave()
    }
    window.addEventListener("online", retryOnReconnect)
    return () => window.removeEventListener("online", retryOnReconnect)
  }, [runSave, clearTimer])

  const warnBeforeUnload = hasUnsavedWork ?? (enabled && isDirty)
  React.useEffect(() => {
    if (!warnBeforeUnload) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [warnBeforeUnload])

  const saveNow = React.useCallback(async (): Promise<ActionState | null> => {
    clearTimer()
    const flight = inFlightRef.current
    if (flight) {
      const awaited = await flight.promise
      // Un fallo en vuelo se informa tal cual: repetirlo de inmediato daría lo mismo.
      if (!awaited.ok) return awaited
      // Lo que acaba de guardarse ya cubre lo que hay en pantalla.
      if (flight.key === watchKeyRef.current || !isDirtyRef.current) return awaited
    } else if (!isDirtyRef.current) {
      return null
    }
    return runSave()
  }, [runSave, clearTimer])

  const flush = React.useCallback(async (): Promise<ActionState | null> => {
    let last: ActionState | null = null
    // Acotado: una persona tecleando sin parar no puede dejar el cierre esperando para siempre.
    for (let round = 0; round < 5; round++) {
      const keyBefore = watchKeyRef.current
      const result = await saveNow()
      if (result === null) return last
      last = result
      if (!result.ok) return result
      if (watchKeyRef.current === keyBefore || !isDirtyRef.current) return result
    }
    return last
  }, [saveNow])

  // Sin nada sin guardar, un fallo viejo ya no describe a la pantalla.
  const failure = isDirty ? failureState : null
  const status: AutosaveStatus = pending ? "saving" : failure ? "error" : isDirty ? "dirty" : "saved"
  return {
    status,
    error: failure?.message ?? null,
    failure,
    retrying: failure?.transient === true,
    saveNow,
    flush,
  }
}

/** Texto corto para mostrar el estado de autoguardado junto a un campo. */
export function autosaveStatusLabel(status: AutosaveStatus): string {
  if (status === "saving") return "Guardando…"
  if (status === "dirty") return "Cambios sin guardar"
  if (status === "error") return "Error al guardar"
  return "Guardado"
}
