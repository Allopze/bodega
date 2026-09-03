"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createLicenseAction } from "./actions"
import { IT_LICENSE_PERIODICITIES } from "@/lib/validation/ti"
import { IT_LICENSE_PERIODICITY_META } from "@/lib/services/ti/constants"

interface LicenseSheetProps {
  trigger: React.ReactNode
  suppliers: { id: string; name: string }[]
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  assets: { id: string; code: string; typeName: string }[]
}

export function LicenseSheet({ trigger, suppliers, workers: _workers, worksites: _worksites, assets: _assets }: LicenseSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [periodicity, setPeriodicity] = React.useState("anual")

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createLicenseAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Licencia registrada")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <SheetHeader>
            <div>
              <SheetTitle>Nueva licencia</SheetTitle>
              <SheetDescription>Software, SaaS o servicio contratado con su cantidad y renovación.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre" required error={state.fieldErrors?.name?.[0]}>
                  <Input name="name" maxLength={120} placeholder="Microsoft 365 Business" />
                </Field>
                <Field label="Proveedor">
                  <Select name="supplierId">
                    <SelectTrigger aria-label="Proveedor">
                      <SelectValue placeholder="Sin proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin proveedor</SelectItem>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Tipo" helper="SaaS, antivirus, hosting…">
                  <Input name="type" maxLength={80} />
                </Field>
                <Field label="Cantidad comprada" required error={state.fieldErrors?.purchasedQuantity?.[0]}>
                  <Input name="purchasedQuantity" type="number" min={0} step={1} defaultValue="0" />
                </Field>
                <Field label="Costo (CLP)">
                  <Input name="cost" type="number" min={0} step={1} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Periodicidad" required>
                  <Select name="periodicity" value={periodicity} onValueChange={setPeriodicity}>
                    <SelectTrigger aria-label="Periodicidad">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_LICENSE_PERIODICITIES.map((p) => (
                        <SelectItem key={p} value={p}>{IT_LICENSE_PERIODICITY_META[p] ?? p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Fecha de inicio">
                  <DatePicker name="startDate" placeholder="Sin fecha" />
                </Field>
                <Field label="Fecha de renovación" helper="Genera alerta 14 días antes.">
                  <DatePicker name="renewalDate" placeholder="Sin fecha" />
                </Field>
              </div>

              <Field label="Notas">
                <Input name="notes" maxLength={500} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Registrar licencia" loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
