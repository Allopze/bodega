"use client"

import { useEffect, useState } from "react"

/**
 * `/m/mantencion?corregir=<registro>` (jefatura llega aquí después de anular un
 * registro): abre un registro nuevo con `correctsRecordId`. El tipo y el equipo
 * pueden venir en el mismo enlace (`tipo=P|C`, `equipo=<id>`); si no, se buscan
 * entre los registros propios del catálogo. Se lee de la URL en el cliente
 * (no del servidor) para que funcione también con el HTML guardado sin señal.
 */
export interface CorrectionLink {
  recordId: string
  kind: "P" | "C" | null
  vehicleId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readCorrectionLink(search: string): CorrectionLink | null {
  const params = new URLSearchParams(search)
  const recordId = params.get("corregir")
  if (!recordId || !UUID.test(recordId)) return null
  const kind = params.get("tipo")
  const vehicleId = params.get("equipo")
  return { recordId, kind: kind === "P" || kind === "C" ? kind : null, vehicleId: vehicleId && vehicleId.length <= 64 ? vehicleId : null }
}

export function useCorrectionLink(): { link: CorrectionLink | null; clear: () => void } {
  const [link, setLink] = useState<CorrectionLink | null>(null)
  useEffect(() => { setLink(readCorrectionLink(window.location.search)) }, [])
  const clear = () => {
    setLink(null)
    try {
      const url = new URL(window.location.href)
      for (const key of ["corregir", "tipo", "equipo"]) url.searchParams.delete(key)
      window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash)
    } catch { /* sin historial */ }
  }
  return { link, clear }
}
