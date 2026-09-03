"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton, SheetTrigger,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OptionSelect } from "@/components/ui/option-select"
import { createLicenseAction, updateLicenseAction } from "./actions"
import { IT_LICENSE_PERIODICITIES } from "@/lib/validation/ti"
import { IT_LICENSE_PERIODICITY_META } from "@/lib/services/ti/constants"

interface LicenseSheetProps {
  trigger: React.ReactNode
  suppliers: { id: string; name: string }[]
  users: { id: string; name: string }[]
  editLicense?: {
    id: string
    name: string
    supplierId: string | null
    type: string | null
    purchasedQuantity: number
    cost: number | null
    periodicity: string
    startDate: string | null
    renewalDate: string | null
    responsibleUserId?: string | null
    notes: string | null
    isActive: boolean
  }
}

export function LicenseSheet({ trigger, suppliers, users, editLicense }: LicenseSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [periodicity, setPeriodicity] = React.useState(editLicense?.periodicity ?? "anual")
  const isEditing = Boolean(editLicense)
  const action = isEditing ? updateLicenseAction : createLicenseAction

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? (isEditing ? "Licencia actualizada" : "Licencia registrada"))
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {editLicense && <input type="hidden" name="id" value={editLicense.id} />}
          {editLicense && <input type="hidden" name="isActive" value={editLicense.isActive ? "true" : "false"} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEditing ? `Editar ${editLicense?.name ?? "licencia"}` : "Nueva licencia"}</SheetTitle>
              <SheetDescription>{isEditing ? "Actualiza los datos de la suscripción y conserva su historial de asignaciones." : "Software, SaaS o servicio contratado con su cantidad y renovación."}</SheetDescription>
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
                  <Input name="name" maxLength={120} placeholder="Microsoft 365 Business" defaultValue={editLicense?.name ?? ""} />
                </Field>
                <Field label="Proveedor">
                  <OptionSelect name="supplierId" defaultValue={editLicense?.supplierId ?? ""} emptyLabel="Sin proveedor" placeholder="Sin proveedor" aria-label="Proveedor" options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Tipo" helper="SaaS, antivirus, hosting…">
                  <Input name="type" maxLength={80} defaultValue={editLicense?.type ?? ""} />
                </Field>
                <Field label="Cantidad comprada" required error={state.fieldErrors?.purchasedQuantity?.[0]}>
                  <Input name="purchasedQuantity" type="number" min={0} step={1} defaultValue={String(editLicense?.purchasedQuantity ?? 0)} />
                </Field>
                <Field label="Costo (CLP)">
                  <Input name="cost" type="number" min={0} step={1} defaultValue={editLicense?.cost != null ? String(editLicense.cost) : ""} />
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
                  <DatePicker name="startDate" defaultValue={editLicense?.startDate ?? ""} placeholder="Sin fecha" />
                </Field>
                <Field label="Fecha de renovación" helper="Genera alerta 14 días antes.">
                  <DatePicker name="renewalDate" defaultValue={editLicense?.renewalDate ?? ""} placeholder="Sin fecha" />
                </Field>
              </div>

              <Field label="Responsable">
                <OptionSelect name="responsibleUserId" defaultValue={editLicense?.responsibleUserId ?? ""} emptyLabel="Sin responsable" placeholder="Sin responsable" aria-label="Responsable" options={users.map((user) => ({ value: user.id, label: user.name }))} />
              </Field>

              <Field label="Notas">
                <Input name="notes" maxLength={500} defaultValue={editLicense?.notes ?? ""} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label={isEditing ? "Guardar cambios" : "Registrar licencia"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
