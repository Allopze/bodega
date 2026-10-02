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
    versions.current = { ...versions.current, ...next }
  }, [])

  /** Versión conocida de una fila: la que debe viajar al borrarla después de editarla. */
  const versionOf = useCallback((entryId: string) => versions.current[entryId], [])

  return { save, sync, versionOf }
}
