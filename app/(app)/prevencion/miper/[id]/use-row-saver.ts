"use client"

import { useCallback, useRef } from "react"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { saveMiperEntryAction } from "../actions"

export type RowSaveResult =
  | { ok: true; version: number; magnitude: number | null; classification: string | null }
  | { ok: false; message: string }

const GENERIC_MESSAGE = "No se pudo guardar la fila."

/**
 * Guardado automático por fila (§8.2). Las ediciones de una misma fila se
 * encolan: cada una espera a la anterior y envía la versión que ésta devolvió,
 * así dos celdas editadas seguidas no chocan con el candado optimista. Filas
 * distintas guardan en paralelo.
 */
export function useRowSaver(matrixId: string, initialVersions: Record<string, number>) {
  const versions = useRef<Record<string, number>>({ ...initialVersions })
  const queues = useRef<Record<string, Promise<RowSaveResult>>>({})

  const save = useCallback((entryId: string, values: MiperEntryValues): Promise<RowSaveResult> => {
    // La cadena nunca rechaza: una fila que falló no debe bloquear la
    // siguiente edición de esa misma fila.
    const previous = queues.current[entryId] ?? Promise.resolve()
    const run: Promise<RowSaveResult> = previous.catch(() => undefined).then(async () => {
      let state: Awaited<ReturnType<typeof saveMiperEntryAction>>
      try {
        state = await saveMiperEntryAction({ matrixId, entryId, expectedVersion: versions.current[entryId], values })
      } catch {
        // Un fallo de infraestructura (red o acción caída) se le presenta a la
        // persona como un rechazo más; el detalle no sirve en una celda.
        return { ok: false as const, message: GENERIC_MESSAGE }
      }
      if (!state.ok) return { ok: false as const, message: state.message ?? GENERIC_MESSAGE }
      const data = state.data as { version?: unknown; magnitude?: unknown; classification?: unknown } | undefined
      if (!data || typeof data.version !== "number") return { ok: false as const, message: GENERIC_MESSAGE }
      versions.current[entryId] = data.version
      return {
        ok: true as const,
        version: data.version,
        magnitude: typeof data.magnitude === "number" ? data.magnitude : null,
        classification: typeof data.classification === "string" ? data.classification : null,
      }
    })
    queues.current[entryId] = run
    return run
  }, [matrixId])

  /** Reancla las versiones cuando la página trae filas nuevas del servidor. */
  const sync = useCallback((next: Record<string, number>) => {
    // Nunca baja una versión: un snapshot atrasado no debe provocar un
    // conflicto falso; una versión más nueva del servidor sí gana.
    const merged = { ...versions.current }
    for (const [id, version] of Object.entries(next)) merged[id] = Math.max(merged[id] ?? 0, version)
    versions.current = merged
  }, [])

  /** Versión conocida de una fila: la que debe viajar al borrarla después de editarla. */
  const versionOf = useCallback((entryId: string) => versions.current[entryId], [])

  /**
   * Espera a que terminen los guardados en curso de esas filas (Fase D): una
   * acción masiva lee después sus versiones, y con un guardado a medio camino
   * mandaría una vieja y chocaría consigo misma. Si mientras espera entra otro
   * guardado a la cola de una de ellas, también lo espera.
   */
  const whenIdle = useCallback(async (entryIds: readonly string[]) => {
    for (;;) {
      const pending = entryIds.map((entryId) => queues.current[entryId])
      await Promise.all(pending.map((run) => run?.catch(() => undefined)))
      if (entryIds.every((entryId, index) => queues.current[entryId] === pending[index])) return
    }
  }, [])

  return { save, sync, versionOf, whenIdle }
}
