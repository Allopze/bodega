"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { applyEntryValues, revertEntryFields } from "@/lib/prevention/miper/entry-values"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { useRowSaver } from "./use-row-saver"

export type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; savedAt: number | null; message: string | null }
export type EntryAutosave = {
  commit: (entry: MiperEntrySnapshot, values: MiperEntryValues) => Promise<boolean>
  /** Estado de guardado DE ESE riesgo: el de otro riesgo no se le contagia. */
  statusOf: (entryId: string) => SaveStatus
  fieldError: (entryId: string, field: string) => string | undefined
  versionOf: (entryId: string) => number | undefined
  /** Descarta los rechazos de un riesgo («Recargar riesgo»): sus campos ya muestran lo del servidor. */
  clearErrors: (entryId: string) => void
}

/** Lo que una acción masiva necesita del guardado automático (Fase D). */
export type AutosaveSync = {
  versionOf: (entryId: string) => number | undefined
  /** Espera los guardados en curso de esos riesgos: después, sus versiones son las del servidor. */
  whenIdle: (entryIds: readonly string[]) => Promise<void>
  /** Anota las versiones que devolvió una acción masiva: el siguiente guardado de cada riesgo parte de ahí. Nunca baja una. */
  acknowledge: (versions: Readonly<Record<string, number>>) => void
}

const IDLE: SaveStatus = { state: "idle", savedAt: null, message: null }
const ownedBy = (entryId: string) => (key: string) => key.startsWith(`${entryId}.`)
const withoutEntries = (errors: Record<string, string>, entryIds: readonly string[]) =>
  Object.fromEntries(Object.entries(errors).filter(([key]) => !entryIds.some((entryId) => ownedBy(entryId)(key))))

/**
 * Guardado del editor del riesgo (spec §5.5). Encima de la cola por fila de
 * `useRowSaver`: cambia la fila al instante, la reclasifica y, si el servidor
 * rechaza, REVIERTE esos campos y deja el motivo en el campo. La grilla dejaba
 * en pantalla el valor no guardado (H5 del diagnóstico).
 *
 * El estado («Guardando…», «Guardado a las…», «No se guardó») es por riesgo: con
 * uno solo para toda la matriz, el editor de B seguía anunciando el rechazo de A
 * y ofrecía un «Recargar riesgo» que a B no le servía de nada.
 */
export function useEntryAutosave({ matrixId, entryVersions, serverRows, setRows, riskFactors }: {
  matrixId: string
  /** Filas autoritativas del servidor: al cambiar de identidad (refresh) reanclan el último valor guardado. */
  serverRows: readonly MiperEntrySnapshot[]
  entryVersions: Record<string, number>
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
}): EntryAutosave & AutosaveSync {
  const { save, sync, versionOf, whenIdle } = useRowSaver(matrixId, entryVersions)
  // Se reancla por contenido, no por identidad: un objeto nuevo con las mismas
  // versiones en cada render pisaría la versión que devolvió el servidor.
  const versionsKey = JSON.stringify(entryVersions)
  useEffect(() => { sync(JSON.parse(versionsKey) as Record<string, number>) }, [versionsKey, sync])
  /** Por riesgo: hora del último guardado limpio. Los guardados en curso viven en `inFlight`. */
  const [savedAt, setSavedAt] = useState<Record<string, number | null>>({})
  const [saving, setSaving] = useState<Record<string, number>>({})
  const inFlight = useRef<Record<string, number>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const errorsRef = useRef<Record<string, string>>({})
  // Último valor que el servidor confirmó por fila (se siembra con la primera
  // fila vista) y contador de commits por campo: una reversión sólo toca los
  // campos que nadie volvió a editar desde entonces.
  const lastSaved = useRef<Record<string, MiperEntrySnapshot>>({})
  const sequence = useRef<Record<string, number>>({})
  /** La última foto del servidor de cada fila, como texto: para saber si cambió entre dos fotos. */
  const seenServerRow = useRef<Record<string, string>>({})
  const writeErrors = (next: Record<string, string>) => { errorsRef.current = next; setErrors(next) }
  const track = (entryId: string, delta: 1 | -1) => {
    const count = (inFlight.current[entryId] ?? 0) + delta
    inFlight.current = { ...inFlight.current, [entryId]: count }
    setSaving(inFlight.current)
    return count
  }

  useEffect(() => {
    const versions = JSON.parse(versionsKey) as Record<string, number>
    const changed: string[] = []
    for (const row of serverRows) {
      // Una foto atrasada (la que Next restaura al volver «atrás») no reancla
      // nada: lo que el cliente guardó después vale más (`useRowsFromSource`
      // también conserva esa fila).
      const known = versionOf(row.id)
      const server = versions[row.id]
      if (known !== undefined && server !== undefined && known > server) continue
      lastSaved.current[row.id] = row
      const fingerprint = JSON.stringify(row)
      const previous = seenServerRow.current[row.id]
      seenServerRow.current[row.id] = fingerprint
      if (previous !== undefined && previous !== fingerprint) changed.push(row.id)
    }
    // Si el riesgo cambió en el servidor, sus campos ya muestran lo nuevo: el
    // rechazo anterior ya no describe nada en pantalla. Un riesgo con un
    // guardado en curso los conserva: si ese guardado falla, tiene que poder
    // revertir y avisar.
    const reseeded = changed.filter((entryId) => (inFlight.current[entryId] ?? 0) === 0)
    if (reseeded.length === 0) return
    for (const key of Object.keys(sequence.current)) {
      if (reseeded.some((entryId) => ownedBy(entryId)(key))) delete sequence.current[key]
    }
    if (Object.keys(errorsRef.current).some((key) => reseeded.some((entryId) => ownedBy(entryId)(key)))) {
      writeErrors(withoutEntries(errorsRef.current, reseeded))
    }
  }, [serverRows, versionsKey, versionOf])

  const commit = useCallback(async (entry: MiperEntrySnapshot, values: MiperEntryValues) => {
    const fields = Object.keys(values)
    if (fields.length === 0) return true
    lastSaved.current[entry.id] ??= entry
    const keys = fields.map((field) => `${entry.id}.${field}`)
    const mine = Object.fromEntries(keys.map((key) => [key, (sequence.current[key] ?? 0) + 1]))
    for (const key of keys) sequence.current[key] = mine[key]!
    setRows((rows) => rows.map((row) => (row.id === entry.id ? applyEntryValues(row, values, riskFactors) : row)))
    track(entry.id, 1)
    const result = await save(entry.id, values)
    const pending = track(entry.id, -1)
    const current = fields.filter((field) => sequence.current[`${entry.id}.${field}`] === mine[`${entry.id}.${field}`])
    if (!result.ok) {
      const saved = lastSaved.current[entry.id]!
      if (current.length > 0) {
        setRows((rows) => rows.map((row) => (row.id === entry.id ? revertEntryFields(row, saved, current) : row)))
        const message = result.message
        // El rechazo nuevo va al final: es el que el estado del riesgo anuncia.
        writeErrors({ ...withoutKeys(errorsRef.current, current.map((field) => `${entry.id}.${field}`)), ...Object.fromEntries(current.map((field) => [`${entry.id}.${field}`, message])) })
        setSavedAt((all) => ({ ...all, [entry.id]: null }))
      }
      return false
    }
    lastSaved.current[entry.id] = applyEntryValues(lastSaved.current[entry.id]!, values, riskFactors)
    writeErrors(withoutKeys(errorsRef.current, keys))
    if (pending === 0 && !Object.keys(errorsRef.current).some(ownedBy(entry.id))) setSavedAt((all) => ({ ...all, [entry.id]: Date.now() }))
    return true
  }, [riskFactors, save, setRows])

  const statusOf = useCallback((entryId: string): SaveStatus => {
    if ((saving[entryId] ?? 0) > 0) return { state: "saving", savedAt: savedAt[entryId] ?? null, message: null }
    const messages = Object.entries(errors).filter(([key]) => ownedBy(entryId)(key)).map(([, message]) => message)
    if (messages.length > 0) return { state: "error", savedAt: null, message: messages[messages.length - 1]! }
    const at = savedAt[entryId] ?? null
    return at === null ? IDLE : { state: "saved", savedAt: at, message: null }
  }, [errors, saving, savedAt])

  const fieldError = useCallback((entryId: string, field: string) => errors[`${entryId}.${field}`], [errors])
  // Sin esto, tras recargar el riesgo el conflicto seguía en el campo y cada
  // guardado posterior, aunque el servidor lo aceptara, volvía a anunciar «No se guardó».
  const clearErrors = useCallback((entryId: string) => {
    writeErrors(withoutEntries(errorsRef.current, [entryId]))
  }, [])
  const acknowledge = useCallback((versions: Readonly<Record<string, number>>) => { sync({ ...versions }) }, [sync])
  return { commit, statusOf, fieldError, versionOf, clearErrors, whenIdle, acknowledge }
}

function withoutKeys(errors: Record<string, string>, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => !keys.includes(key)))
}
