"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Trash } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { revertBatchOperationsAction, linkOperationVehicleAction, linkOperationWorksiteAction } from "../../actions-operaciones"
import type { ActionState } from "@/lib/validation/masters"

const INITIAL_STATE: ActionState = { ok: true }

export function RevertOperationsBatchButton({ batchId, canRevert }: { batchId: string; canRevert: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!canRevert) return null

  async function handleConfirm() {
    setLoading(true)
    const fd = new FormData()
    fd.set("batchId", batchId)
    const res = await revertBatchOperationsAction(INITIAL_STATE, fd)
    setLoading(false)
    setOpen(false)
    if (res.ok) {
      toast.success(res.message ?? "Lote revertido")
      router.refresh()
    } else {
      toast.error(res.message ?? "No se pudo revertir el lote")
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash className="h-4 w-4 mr-1.5" /> Revertir lote
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Revertir este lote?"
        description="Se eliminarán todos los registros del log operacional de este lote del dashboard. El archivo original y el historial del lote se conservan para trazabilidad. Esta acción no se puede deshacer."
        variant="destructive"
        confirmLabel="Revertir"
        onConfirm={handleConfirm}
        loading={loading}
      />
    </>
  )
}

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
        <SelectTrigger className="w-48"><SelectValue placeholder="Elegir vehículo…" /></SelectTrigger>
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
        <SelectTrigger className="w-48"><SelectValue placeholder="Elegir faena…" /></SelectTrigger>
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
