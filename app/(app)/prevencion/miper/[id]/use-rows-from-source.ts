"use client"

import { useState } from "react"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

/** Lo que hace falta para saber si la foto del servidor está atrasada respecto de una fila. */
export type RowVersions = {
  /** Versión de cada fila en la foto que llega (`workspace.entryVersions`). */
  serverVersions: Readonly<Record<string, number>>
  /** Versión que el cliente ya conoce de esa fila: la última que devolvió un guardado propio. */
  versionOf: (entryId: string) => number | undefined
}

/**
 * Las filas que edita el cliente, resincronizadas con la foto del servidor en
 * el MISMO render en que llega una nueva (patrón de React «storing information
 * from previous renders»), no en un efecto.
 *
 * Next no remonta la página al cambiar sólo la query, así que el `useState`
 * conserva las filas viejas. Con un efecto, tras crear un riesgo
 * (`router.push(?fila=nuevo)`) el editor se montaba un render antes que la fila
 * nueva: mostraba el esqueleto y pedía un `router.refresh()` de más, cuya
 * segunda foto podía pisar lo que ya se estaba escribiendo.
 *
 * La foto nueva no siempre es más nueva: al volver «atrás» Next puede restaurar
 * la de un render anterior. Por eso, si el cliente ya guardó una fila en una
 * versión MAYOR que la de la foto, esa fila se queda como está; todas las demás
 * (también las nuevas y la falta de las borradas) salen de la foto.
 */
export function useRowsFromSource(source: { entries: MiperEntrySnapshot[] }, versions?: RowVersions) {
  const [synced, setSynced] = useState(source)
  const [rows, setRows] = useState<MiperEntrySnapshot[]>(source.entries)
  if (synced !== source) {
    const next = keepNewerClientRows(source.entries, rows, versions)
    setSynced(source)
    setRows(next)
    // React repite el render antes de pintar hijos; devolver ya las filas nuevas evita calcular nada con las viejas.
    return [next, setRows] as const
  }
  return [rows, setRows] as const
}

function keepNewerClientRows(snapshot: MiperEntrySnapshot[], clientRows: readonly MiperEntrySnapshot[], versions: RowVersions | undefined): MiperEntrySnapshot[] {
  if (!versions) return snapshot
  const client = new Map(clientRows.map((row) => [row.id, row]))
  let kept = false
  const merged = snapshot.map((row) => {
    const known = versions.versionOf(row.id)
    const server = versions.serverVersions[row.id]
    const mine = client.get(row.id)
    if (mine && known !== undefined && server !== undefined && known > server) {
      kept = true
      return mine
    }
    return row
  })
  // Sin nada que conservar se devuelve la foto misma: su identidad estable es la que esperan los `useMemo` de abajo.
  return kept ? merged : snapshot
}
