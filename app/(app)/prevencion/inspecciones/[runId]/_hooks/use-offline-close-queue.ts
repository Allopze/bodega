"use client"

import * as React from "react"
import { useOnlineStatus } from "@/lib/pwa/hooks"
import {
  OfflineQueueFullError,
  discardQueuedInspectionSubmission,
  flushInspectionSubmissionQueue,
  getQueuedInspectionSubmission,
  isInspectionSubmissionRejected,
  queueInspectionSubmission,
  type InspectionQueueFlushResult,
  type InspectionSubmissionSendResult,
  type OfflineInspectionSubmission,
  type QueuedInspectionSubmission,
} from "../offline-inspection-queue"

/**
 * El cierre de ESTA inspección guardado en el dispositivo. `rejected` distingue
 * el que sigue esperando señal («Cierre guardado en este dispositivo», con
 * «Enviar ahora») del que el servidor rechazó o agotó sus reintentos («No se
 * pudo enviar…», con «Recuperar» y «Descartar»): `lastError` trae el motivo y
 * `lastCode` el código cuando el rechazo fue permanente.
 */
export interface OfflineCloseEntry extends QueuedInspectionSubmission {
  rejected: boolean
}

function toEntry(entry: QueuedInspectionSubmission | null): OfflineCloseEntry | null {
  return entry ? { ...entry, rejected: isInspectionSubmissionRejected(entry) } : null
}

export interface UseOfflineCloseQueueOptions {
  runId: string
  /**
   * `false` apaga todo: no lee la cola, no envía solo y `sendNow` no hace nada.
   * Pensado para una pantalla que no puede tener un cierre propio en cola.
   */
  enabled?: boolean
  /**
   * Envía un cierre. Se le pasa la acción tal cual: el código del rechazo se lee
   * de `data.code` (ver `saveErrorCodeOf`), y una excepción cuenta como fallo de
   * red. Se lee desde un ref: no hace falta memoizarla.
   */
  send: (payload: OfflineInspectionSubmission) => Promise<InspectionSubmissionSendResult>
  /** El cierre de esta inspección llegó al servidor y salió de la cola. Con la respuesta de `send`. */
  onDelivered?: (result: InspectionSubmissionSendResult) => void
}

export type QueueCloseResult =
  | { ok: true; entry: OfflineCloseEntry }
  | { ok: false; message: string }

/**
 * Canal de cierre sin conexión de una inspección (P1-5).
 *
 * Es el único dueño de la cola en la pantalla: guarda el cierre, lo envía y
 * muestra en qué quedó. Vacía la cola al montar si ya hay conexión —el evento
 * `online` no dispara en una página abierta con señal, y un cierre encolado en
 * una sesión anterior quedaba sin enviar—, al volver la señal y con `sendNow`.
 * Un envío en vuelo no se duplica: los disparadores simultáneos comparten el
 * mismo vuelo, y sin conexión no se gastan reintentos.
 *
 * Mientras `entry` exista, quien use este hook debe pausar el autoguardado: los
 * dos canales competirían por el mismo `expectedVersion` y el que llegara
 * segundo se rechazaría por conflicto.
 */
export function useOfflineCloseQueue({ runId, enabled = true, send, onDelivered }: UseOfflineCloseQueueOptions) {
  const online = useOnlineStatus()
  const [entry, setEntry] = React.useState<OfflineCloseEntry | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [sending, setSending] = React.useState(false)

  const sendRef = React.useRef(send)
  React.useEffect(() => {
    sendRef.current = send
  })
  const onDeliveredRef = React.useRef(onDelivered)
  React.useEffect(() => {
    onDeliveredRef.current = onDelivered
  })
  const flightRef = React.useRef<Promise<InspectionQueueFlushResult | null> | null>(null)
  // Se reasigna en cada montaje (también el segundo de StrictMode).
  const mountedRef = React.useRef(false)
  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Lectura inicial: qué hay guardado para esta inspección.
  React.useEffect(() => {
    if (!enabled) {
      setEntry(null)
      setLoaded(true)
      return
    }
    let cancelled = false
    getQueuedInspectionSubmission(runId)
      .then((stored) => { if (!cancelled) setEntry(toEntry(stored)) })
      // IndexedDB bloqueado (ventana privada, datos del sitio bloqueados): sin
      // cola no hay cierre en espera, y la pantalla sigue funcionando.
      .catch(() => { if (!cancelled) setEntry(null) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [runId, enabled])

  const flush = React.useCallback((): Promise<InspectionQueueFlushResult | null> => {
    if (flightRef.current) return flightRef.current
    const flight = (async () => {
      setSending(true)
      // Objeto y no variable: el `sender` la asigna desde un cierre y TypeScript
      // no sigue esa asignación al leerla abajo.
      const outcome: { delivered: InspectionSubmissionSendResult | null } = { delivered: null }
      let result: InspectionQueueFlushResult | null = null
      let stored: QueuedInspectionSubmission | null = null
      try {
        result = await flushInspectionSubmissionQueue(async (payload) => {
          const response = await sendRef.current(payload)
          if (response.ok && payload.runId === runId) outcome.delivered = response
          return response
        })
        stored = await getQueuedInspectionSubmission(runId)
      } catch {
        // El almacenamiento falló: no hay nada que mostrar ni que reintentar
        // desde aquí, y una excepción suelta rompería la pantalla de captura.
        result = null
      } finally {
        flightRef.current = null
        if (mountedRef.current) setSending(false)
      }
      // Fuera del try: una excepción de `onDelivered` no es un fallo de la cola.
      if (result && mountedRef.current) {
        setEntry(toEntry(stored))
        if (outcome.delivered && !stored) onDeliveredRef.current?.(outcome.delivered)
      }
      return result
    })()
    flightRef.current = flight
    return flight
  }, [runId])

  // Al montar con conexión y cada vez que vuelve la señal.
  React.useEffect(() => {
    if (enabled && online) void flush()
  }, [enabled, online, flush])

  /** «Enviar ahora». Sin conexión no hace nada (no gasta un reintento en balde). */
  const sendNow = React.useCallback(async (): Promise<InspectionQueueFlushResult | null> => {
    if (!enabled) return null
    if (typeof navigator !== "undefined" && navigator.onLine === false) return null
    return flush()
  }, [enabled, flush])

  /**
   * Guarda el cierre en el dispositivo. Siempre bajo el `runId` del hook: un
   * cierre no puede encolarse a nombre de otra inspección. El almacenamiento
   * lleno o bloqueado vuelve como `{ ok: false, message }` para mostrarlo.
   */
  const queue = React.useCallback(async (
    payload: Omit<OfflineInspectionSubmission, "runId"> & { runId?: string },
  ): Promise<QueueCloseResult> => {
    try {
      const stored = toEntry(await queueInspectionSubmission({ ...payload, runId }))
      if (!stored) return { ok: false, message: "No se pudo guardar el cierre en este dispositivo." }
      if (mountedRef.current) setEntry(stored)
      return { ok: true, entry: stored }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof OfflineQueueFullError
          ? error.message
          : "No se pudo guardar el cierre en este dispositivo. No cierres esta pestaña hasta enviarlo.",
      }
    }
  }, [runId])

  /** «Descartar»: borra el cierre guardado sin enviarlo. `false` si no se pudo borrar. */
  const discard = React.useCallback(async (): Promise<boolean> => {
    try {
      await discardQueuedInspectionSubmission(runId)
    } catch {
      return false
    }
    if (mountedRef.current) setEntry(null)
    return true
  }, [runId])

  return { entry, loaded, sending, queue, sendNow, discard }
}
