"use client"

import { useActionState, useState } from "react"
import { createFuelVehicleAction, type ActionState } from "../actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"

export function NewVehicleDialog({ worksites }: { worksites: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createFuelVehicleAction, { ok: false, message: "" })

  if (state.ok && open) {
    toast.success(state.message)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo vehículo</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo vehículo</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label>Patente *</Label>
            <Input name="plate" required placeholder="XX-XX-00" />
            {state.fieldErrors?.plate && <p className="text-sm text-destructive">{state.fieldErrors.plate[0]}</p>}
          </div>
          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select name="type" required>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="camion">Camión</SelectItem>
                <SelectItem value="camioneta">Camioneta</SelectItem>
                <SelectItem value="estanque">Estanque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Marca</Label>
              <Input name="brand" />
            </div>
            <div className="space-y-2">
              <Label>Modelo</Label>
              <Input name="model" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Año</Label>
              <Input name="year" type="number" min="1990" max="2030" />
            </div>
            <div className="space-y-2">
              <Label>Faena asignada *</Label>
              <Select name="worksiteId" required>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {worksites.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {state.fieldErrors?.worksiteId && <p className="text-sm text-destructive">{state.fieldErrors.worksiteId[0]}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Guardando..." : "Crear"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
