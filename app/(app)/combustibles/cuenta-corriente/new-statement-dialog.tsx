"use client"

import { useActionState, useState } from "react"
import { createMonthlyStatementAction } from "../actions"
import type { ActionState } from "@/lib/validation/masters"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { formatPeriodOption, recentPeriods } from "@/components/ui/period-picker"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"

export function NewStatementDialog({ suppliers }: { suppliers: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createMonthlyStatementAction, { ok: false, message: "" })

  if (state.ok && open) {
    toast.success(state.message)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo resumen</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear resumen mensual</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label>Mes *</Label>
            {/* Select propio en vez de <input type="month">: el nativo se rinde
                según el locale del navegador (UI/UX 2026-08-05, M8). */}
            <OptionSelect
              name="month"
              defaultValue={recentPeriods(1)[0]}
              options={recentPeriods(24).map((value) => ({ value, label: formatPeriodOption(value) }))}
              aria-label="Mes"
            />
            {state.fieldErrors?.month && <p className="text-sm text-destructive">{state.fieldErrors.month[0]}</p>}
          </div>
          <div className="space-y-2">
            <Label>Proveedor *</Label>
            <Select name="fuelSupplierId" required>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {state.fieldErrors?.fuelSupplierId && <p className="text-sm text-destructive">{state.fieldErrors.fuelSupplierId[0]}</p>}
          </div>
          <div className="space-y-2">
            <Label>Fecha de vencimiento</Label>
            <DatePicker name="dueDate" />
          </div>
          {state.message && !state.ok && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Creando..." : "Crear resumen"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
