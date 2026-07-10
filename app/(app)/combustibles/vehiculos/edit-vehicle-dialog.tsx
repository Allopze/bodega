"use client"

import { useState } from "react"
import { useActionState } from "react"
import { updateFuelVehicleAction } from "../actions"
import type { ActionState } from "@/lib/validation/masters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Pencil } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { FUEL_VEHICLE_TYPES, FUEL_VEHICLE_TYPE_LABELS } from "@/lib/combustibles/validation"

interface Vehicle {
  id: string
  plate: string
  code: string | null
  type: string
  brand: string | null
  model: string | null
  year: number | null
  worksiteId: string | null
}

export function EditVehicleDialog({ vehicle, worksites }: { vehicle: Vehicle; worksites: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(updateFuelVehicleAction, { ok: false })

  // Los tipos del catálogo real no siempre calzan con la lista canónica (hay
  // valores legacy libres). Si el vehículo tiene un tipo fuera de la lista, se
  // agrega como opción para que se pueda ver y conservar al guardar.
  const typeOptions: Array<{ value: string; label: string }> = FUEL_VEHICLE_TYPES.map((t) => ({ value: t, label: FUEL_VEHICLE_TYPE_LABELS[t] }))
  if (vehicle.type && !FUEL_VEHICLE_TYPES.includes(vehicle.type as (typeof FUEL_VEHICLE_TYPES)[number])) {
    typeOptions.unshift({ value: vehicle.type, label: vehicle.type })
  }

  if (state.ok && open) {
    toast.success(state.message ?? "Vehículo actualizado")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar vehículo</DialogTitle></DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={vehicle.id} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Patente *</Label>
              <Input name="plate" defaultValue={vehicle.plate} required />
            </div>
            <div className="space-y-2">
              <Label>Código interno</Label>
              <Input name="code" defaultValue={vehicle.code ?? ""} placeholder="Ej. KA-63" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select name="type" defaultValue={vehicle.type}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {typeOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Marca</Label>
              <Input name="brand" defaultValue={vehicle.brand ?? ""} />
            </div>
            <div className="space-y-2">
              <Label>Modelo</Label>
              <Input name="model" defaultValue={vehicle.model ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Año</Label>
              <Input name="year" type="number" defaultValue={vehicle.year?.toString() ?? ""} />
            </div>
            <div className="space-y-2">
              <Label>Faena *</Label>
              <Select name="worksiteId" required defaultValue={vehicle.worksiteId ?? undefined}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {worksites.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {state.fieldErrors?.worksiteId && <p className="text-sm text-destructive">{state.fieldErrors.worksiteId[0]}</p>}
            </div>
          </div>
          {state.message && !state.ok && <p className="text-sm text-[var(--color-danger)]">{state.message}</p>}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Guardando..." : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
