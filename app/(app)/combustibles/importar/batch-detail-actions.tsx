"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { linkConsumptionPlateAction } from "../actions-consumos"
import type { ActionState } from "@/lib/validation/masters"

const INITIAL_STATE: ActionState = { ok: true }

export function LinkPlateForm({
  batchId, patente, vehicles,
}: {
  batchId: string
  patente: string
  vehicles: Array<{ id: string; plate: string }>
}) {
  const router = useRouter()
  const [vehicleId, setVehicleId] = useState("")
  const [state, formAction, pending] = useActionState(async (_prev: ActionState, fd: FormData) => {
    const res = await linkConsumptionPlateAction(_prev, fd)
    if (res.ok) { toast.success(res.message); router.refresh() }
    else toast.error(res.message)
    return res
  }, INITIAL_STATE)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="patente" value={patente} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <Select value={vehicleId} onValueChange={setVehicleId}>
        <SelectTrigger aria-label="Elegir vehículo…" className="w-48"><SelectValue placeholder="Elegir vehículo…" /></SelectTrigger>
        <SelectContent>
          {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={!vehicleId || pending}>
        {pending ? "Vinculando..." : "Vincular"}
      </Button>
      {state.fieldErrors && <span className="text-xs text-[var(--color-danger)]">Revisa los datos</span>}
    </form>
  )
}
