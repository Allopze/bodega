"use client"

import * as React from "react"
import { linkHistoricalAction } from "@/app/(app)/mantencion/registros/historicos/actions"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"

export function HistoricalLinkForm({ sourceKey, needsVehicle, needsWorksite, vehicles, sites }: {
  sourceKey: string; needsVehicle: boolean; needsWorksite: boolean; vehicles: ComboboxOption[]; sites: ComboboxOption[]
}) {
  const [vehicleId, setVehicleId] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const save = useOperation({ feedback: "toast" })
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save.run(() => linkHistoricalAction({ sourceKey, vehicleId: vehicleId || undefined, worksiteId: worksiteId || undefined }))
  }
  return <form onSubmit={submit} className="space-y-4">
    <Callout tone="warning">Compara los datos originales antes de elegir. La asociación quedará registrada con tu usuario.</Callout>
    {needsVehicle && <Field label="Equipo" htmlFor="historical-vehicle"><Combobox id="historical-vehicle" options={vehicles} value={vehicleId} onChange={setVehicleId} clearLabel="Sin identificar" placeholder="Buscar código o patente" /></Field>}
    {needsWorksite && <Field label="Faena" htmlFor="historical-worksite"><Combobox id="historical-worksite" options={sites} value={worksiteId} onChange={setWorksiteId} clearLabel="Sin identificar" placeholder="Buscar faena" /></Field>}
    <Button type="submit" loading={save.pending} disabled={!vehicleId && !worksiteId}>Guardar</Button>
  </form>
}
