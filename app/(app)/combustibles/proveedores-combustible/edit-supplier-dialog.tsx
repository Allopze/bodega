"use client"

import { useState } from "react"
import { useActionState } from "react"
import { updateFuelSupplierAction } from "../actions"
import type { ActionState } from "@/lib/validation/masters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Pencil } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"

interface Supplier {
  id: string
  name: string
  rut: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
}

export function EditSupplierDialog({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(updateFuelSupplierAction, { ok: false })

  if (state.ok && open) {
    toast.success(state.message ?? "Proveedor actualizado")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar proveedor</DialogTitle></DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={supplier.id} />
          <div className="space-y-2">
            <Label>Nombre *</Label>
            <Input name="name" defaultValue={supplier.name} required />
          </div>
          <div className="space-y-2">
            <Label>RUT</Label>
            <Input name="rut" defaultValue={supplier.rut ?? ""} />
          </div>
          <div className="space-y-2">
            <Label>Contacto</Label>
            <Input name="contactName" defaultValue={supplier.contactName ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input name="contactPhone" defaultValue={supplier.contactPhone ?? ""} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input name="contactEmail" type="email" defaultValue={supplier.contactEmail ?? ""} />
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
