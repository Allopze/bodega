"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { linkOperationVehicleAction, linkOperationWorksiteAction } from "../../actions-operaciones-batch"
import type { ActionState } from "@/lib/validation/masters"

const INITIAL_STATE: ActionState = { ok: true }

export function LinkOperationVehicleForm({
  batchId, plate, vehicles,
}: {
  batchId: string
  plate: string
  vehicles: Array<{ id: string; plate: string }>
}) {
  const router = useRouter()
  const [vehicleId, setVehicleId] = useState("")
  const [state, formAction, pending] = useActionState(async (_prev: ActionState, fd: FormData) => {
    const res = await linkOperationVehicleAction(_prev, fd)
    if (res.ok) { toast.success(res.message); router.refresh() }
    else toast.error(res.message)
    return res
  }, INITIAL_STATE)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="plate" value={plate} />
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

export function LinkOperationWorksiteForm({
  batchId, faenaNombre, worksites,
}: {
  batchId: string
  faenaNombre: string
  worksites: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [worksiteId, setWorksiteId] = useState("")
  const [state, formAction, pending] = useActionState(async (_prev: ActionState, fd: FormData) => {
    const res = await linkOperationWorksiteAction(_prev, fd)
    if (res.ok) { toast.success(res.message); router.refresh() }
    else toast.error(res.message)
    return res
  }, INITIAL_STATE)

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="faenaNombre" value={faenaNombre} />
      <input type="hidden" name="worksiteId" value={worksiteId} />
      <Select value={worksiteId} onValueChange={setWorksiteId}>
        <SelectTrigger aria-label="Elegir faena…" className="w-48"><SelectValue placeholder="Elegir faena…" /></SelectTrigger>
        <SelectContent>
          {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={!worksiteId || pending}>
        {pending ? "Vinculando..." : "Vincular"}
      </Button>
      {state.fieldErrors && <span className="text-xs text-[var(--color-danger)]">Revisa los datos</span>}
    </form>
  )
}
