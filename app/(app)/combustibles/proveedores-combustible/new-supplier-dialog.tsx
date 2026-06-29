"use client"

import { useActionState, useState } from "react"
import { createFuelSupplierAction } from "../actions"
import type { ActionState } from "@/lib/validation/masters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"

export function NewSupplierDialog() {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createFuelSupplierAction, { ok: false, message: "" })

  if (state.ok && open) {
    toast.success(state.message)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo proveedor</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo proveedor de combustible</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre *</Label>
            <Input name="name" required placeholder="COPEC, ARAMCO..." />
            {state.fieldErrors?.name && <p className="text-sm text-destructive">{state.fieldErrors.name[0]}</p>}
          </div>
          <div className="space-y-2">
            <Label>RUT</Label>
            <Input name="rut" placeholder="12.345.678-9" />
          </div>
          <div className="space-y-2">
            <Label>Contacto</Label>
            <Input name="contactName" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input name="contactPhone" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input name="contactEmail" type="email" />
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
