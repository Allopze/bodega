"use client"

import { useState } from "react"
import { Sheet } from "./dialog"
import { EquipmentPicker, type PickerScope } from "./equipment-picker"

/** «Historial de un equipo»: el mismo buscador del paso «equipo», pero al elegir se abre su historial. */
export function HistorySearchSheet({ onPick, onClose }: { onPick: (vehicleId: string) => void; onClose: () => void }) {
  const [scope, setScope] = useState<PickerScope>("mine")
  const [query, setQuery] = useState("")
  return (
    <Sheet title="Historial de un equipo" onClose={onClose} stable>
      <EquipmentPicker scope={scope} query={query} inputId="hq" onScope={setScope} onQuery={setQuery} onPick={(row) => onPick(row.eq.id)} />
      <button type="button" className="btns wide" onClick={onClose}>Cerrar</button>
    </Sheet>
  )
}
