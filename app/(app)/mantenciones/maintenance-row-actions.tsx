"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { MaintenanceForm, type MaintenanceDefaults } from "./maintenance-form"
import { updateMaintenanceRecordAction, cancelMaintenanceRecordAction } from "./actions"
import { toast } from "@/lib/toast"

interface Option {
  id: string
  name: string
}

interface VehicleOption {
  id: string
  plate: string
  type: string
}

export function MaintenanceRowActions({
  record,
  vehicles,
  suppliers,
  worksites,
  costCenters,
}: {
  record: MaintenanceDefaults & { id: string; status: string }
  vehicles: VehicleOption[]
  suppliers: Option[]
  worksites: Option[]
  costCenters: Array<Option & { code: string }>
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  async function handleCancel() {
    setCancelling(true)
    // Sin `finally`, un rechazo de la action (red caída, error no capturado)
    // dejaba el botón en "Cancelando..." y el diálogo abierto para siempre.
    try {
      const res = await cancelMaintenanceRecordAction(record.id)
      setConfirmOpen(false)
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
    } catch {
      toast.error("No se pudo cancelar la mantención. Reintenta.")
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost">Editar</Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Editar mantención</DialogTitle></DialogHeader>
          <MaintenanceForm
            vehicles={vehicles}
            suppliers={suppliers}
            worksites={worksites}
            costCenters={costCenters}
            action={updateMaintenanceRecordAction}
            submitLabel="Guardar"
            defaults={record}
            onSuccess={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {record.status !== "cancelled" && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive">Cancelar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancelar mantención</DialogTitle></DialogHeader>
            <p className="text-sm text-[var(--color-text-muted)]">
              La mantención quedará marcada como cancelada y dejará de sumar al costo de flota. Esta acción no la elimina.
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={cancelling}>Volver</Button>
              <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? "Cancelando..." : "Cancelar mantención"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
