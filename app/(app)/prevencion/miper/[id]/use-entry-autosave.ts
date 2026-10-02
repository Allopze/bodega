"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { applyEntryValues, revertEntryFields } from "@/lib/prevention/miper/entry-values"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { useRowSaver } from "./use-row-saver"

export type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; savedAt: number | null; message: string | null }
export type EntryAutosave = {
  commit: (entry: MiperEntrySnapshot, values: MiperEntryValues) => Promise<boolean>
  status: SaveStatus
  fieldError: (entryId: string, field: string) => string | undefined
  versionOf: (entryId: string) => number | undefined
}

/**
 * Guardado del editor del riesgo (spec §5.5). Encima de la cola por fila de
 * `useRowSaver`: cambia la fila al instante, la reclasifica y, si el servidor
 * rechaza, REVIERTE esos campos y deja el motivo en el campo. La grilla dejaba
 * en pantalla el valor no guardado (H5 del diagnóstico).
 */
export function useEntryAutosave({ matrixId, entryVersions, serverRows, setRows, riskFactors }: {
  matrixId: string
  /** Filas autoritativas del servidor: al cambiar de identidad (refresh) reanclan el último valor guardado. */
  serverRows: readonly MiperEntrySnapshot[]
  entryVersions: Record<string, number>
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
}): EntryAutosave {
  const { save, sync, versionOf } = useRowSaver(matrixId, entryVersions)
  // Se reancla por contenido, no por identidad: un objeto nuevo con las mismas
  // versiones en cada render pisaría la versión que devolvió el servidor.
  const versionsKey = JSON.stringify(entryVersions)
  useEffect(() => { sync(JSON.parse(versionsKey) as Record<string, number>) }, [versionsKey, sync])
  const [status, setStatus] = useState<SaveStatus>({ state: "idle", savedAt: null, message: null })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const errorsRef = useRef<Record<string, string>>({})
  const inFlight = useRef(0)
  // Último valor que el servidor confirmó por fila (se siembra con la primera
  // fila vista) y contador de commits por campo: una reversión sólo toca los
  // campos que nadie volvió a editar desde entonces.
  const lastSaved = useRef<Record<string, MiperEntrySnapshot>>({})
  const sequence = useRef<Record<string, number>>({})
  useEffect(() => {
    for (const row of serverRows) lastSaved.current[row.id] = row
  }, [serverRows])
  const writeErrors = (next: Record<string, string>) => { errorsRef.current = next; setErrors(next) }

  const commit = useCallback(async (entry: MiperEntrySnapshot, values: MiperEntryValues) => {
    const fields = Object.keys(values)
    if (fields.length === 0) return true
    lastSaved.current[entry.id] ??= entry
    const keys = fields.map((field) => `${entry.id}.${field}`)
    const mine = Object.fromEntries(keys.map((key) => [key, (sequence.current[key] ?? 0) + 1]))
    for (const key of keys) sequence.current[key] = mine[key]!
    setRows((rows) => rows.map((row) => (row.id === entry.id ? applyEntryValues(row, values, riskFactors) : row)))
    inFlight.current += 1
    setStatus((current) => ({ ...current, state: "saving", message: null }))
    const result = await save(entry.id, values)
    inFlight.current -= 1
    const current = fields.filter((field) => sequence.current[`${entry.id}.${field}`] === mine[`${entry.id}.${field}`])
    if (!result.ok) {
      const saved = lastSaved.current[entry.id]!
      if (current.length > 0) {
        setRows((rows) => rows.map((row) => (row.id === entry.id ? revertEntryFields(row, saved, current) : row)))
        const message = result.message
        writeErrors({ ...errorsRef.current, ...Object.fromEntries(current.map((field) => [`${entry.id}.${field}`, message])) })
        setStatus({ state: "error", savedAt: null, message })
      }
      return false
    }
    lastSaved.current[entry.id] = applyEntryValues(lastSaved.current[entry.id]!, values, riskFactors)
    writeErrors(Object.fromEntries(Object.entries(errorsRef.current).filter(([key]) => !keys.includes(key))))
    if (inFlight.current === 0) {
      const remaining = Object.values(errorsRef.current)[0]
      setStatus(remaining ? { state: "error", savedAt: null, message: remaining } : { state: "saved", savedAt: Date.now(), message: null })
    }
    return true
  }, [riskFactors, save, setRows])

  const fieldError = useCallback((entryId: string, field: string) => errors[`${entryId}.${field}`], [errors])
  return { commit, status, fieldError, versionOf }
}
