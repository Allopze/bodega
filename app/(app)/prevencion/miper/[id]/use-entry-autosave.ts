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
export function useEntryAutosave({ matrixId, entryVersions, setRows, riskFactors }: {
  matrixId: string
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
  const inFlight = useRef(0)

  const commit = useCallback(async (entry: MiperEntrySnapshot, values: MiperEntryValues) => {
    const fields = Object.keys(values)
    if (fields.length === 0) return true
    setRows((rows) => rows.map((row) => (row.id === entry.id ? applyEntryValues(row, values, riskFactors) : row)))
    inFlight.current += 1
    setStatus((current) => ({ ...current, state: "saving", message: null }))
    const result = await save(entry.id, values)
    inFlight.current -= 1
    const keys = fields.map((field) => `${entry.id}.${field}`)
    if (!result.ok) {
      setRows((rows) => rows.map((row) => (row.id === entry.id ? revertEntryFields(row, entry, fields) : row)))
      setErrors((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, result.message])) }))
      setStatus({ state: "error", savedAt: null, message: result.message })
      return false
    }
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))))
    if (inFlight.current === 0) setStatus({ state: "saved", savedAt: Date.now(), message: null })
    return true
  }, [riskFactors, save, setRows])

  const fieldError = useCallback((entryId: string, field: string) => errors[`${entryId}.${field}`], [errors])
  return { commit, status, fieldError, versionOf }
}
