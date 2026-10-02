"use client"

import { useState } from "react"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

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
 */
export function useRowsFromSource(source: { entries: MiperEntrySnapshot[] }) {
  const [synced, setSynced] = useState(source)
  const [rows, setRows] = useState<MiperEntrySnapshot[]>(source.entries)
  if (synced !== source) {
    setSynced(source)
    setRows(source.entries)
    // React repite el render antes de pintar hijos; devolver ya las filas nuevas evita calcular nada con las viejas.
    return [source.entries, setRows] as const
  }
  return [rows, setRows] as const
}
