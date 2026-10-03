"use client"

import { useCallback, useMemo, useState } from "react"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

/**
 * Selección de riesgos para las acciones masivas (Fase D, spec §9). Es un modo:
 * sin «Seleccionar» no hay casillas y la vista filtrada sigue liviana (spec §13,
 * menos de 400 controles). Sólo cuenta lo que se ve: un riesgo seleccionado que
 * un filtro esconde, o que desaparece tras recargar, sale de la selección que se
 * muestra y que se envía; si vuelve a verse, vuelve marcado.
 */
export function useRiskSelection(visible: readonly MiperEntrySnapshot[]) {
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const selected = useMemo(() => visible.filter((entry) => chosen.has(entry.id)), [visible, chosen])
  const isSelected = useCallback((entryId: string) => chosen.has(entryId), [chosen])
  const toggle = useCallback((entryId: string) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }, [])
  const selectAll = useCallback(() => setChosen(new Set(visible.map((entry) => entry.id))), [visible])
  const clear = useCallback(() => setChosen(new Set()), [])
  const start = useCallback(() => setSelecting(true), [])
  const stop = useCallback(() => { setSelecting(false); setChosen(new Set()) }, [])
  return { selecting, selected, isSelected, toggle, selectAll, clear, start, stop }
}

export type RiskSelection = ReturnType<typeof useRiskSelection>
