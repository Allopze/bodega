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
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OptionSelect } from "@/components/ui/option-select"
import { todayInChile } from "@/lib/utils"
import { createMaintenanceAction, updateMaintenanceAction } from "./actions"
import { IT_MAINTENANCE_TYPES } from "@/lib/validation/ti"
import { IT_MAINTENANCE_TYPE_META } from "@/lib/services/ti/constants"

interface MaintenanceSheetProps {
  trigger: React.ReactNode
  assetId?: string
  suppliers: { id: string; name: string }[]
  assets?: { id: string; code: string; typeName: string }[]
  editMaintenance?: {
    id: string
    assetId: string
    type: string
    date: string
    reportedIssue: string | null
    diagnosis: string | null
    workDone: string
    partsUsed: string | null
    supplierId: string | null
    technicianName: string | null
    technicianUserId: string | null
    cost: number
    observations: string | null
  }
}

export function MaintenanceSheet({ trigger, assetId, suppliers, assets = [], editMaintenance }: MaintenanceSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState(editMaintenance?.type ?? "correctiva")
  const [date, setDate] = React.useState(editMaintenance?.date ?? todayInChile())
  const isEditing = Boolean(editMaintenance)
  const effectiveAssetId = editMaintenance?.assetId ?? assetId ?? ""

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await (isEditing ? updateMaintenanceAction : createMaintenanceAction)(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? (isEditing ? "Mantención actualizada" : "Mantención registrada"))
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {effectiveAssetId && <input type="hidden" name="assetId" value={effectiveAssetId} />}
          {editMaintenance && <input type="hidden" name="id" value={editMaintenance.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEditing ? "Editar mantención" : "Registrar mantención"}</SheetTitle>
              <SheetDescription>Preventiva, correctiva, reparación, actualización o revisión.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              {!effectiveAssetId && (
                <Field label="Activo" required error={state.fieldErrors?.assetId?.[0]}>
                  <Select name="assetId">
                    <SelectTrigger aria-label="Activo">
                      <SelectValue placeholder="Selecciona un activo" />
                    </SelectTrigger>
                    <SelectContent>
                      {assets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} · {a.typeName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo" required>
                  <Select name="type" value={type} onValueChange={setType}>
                    <SelectTrigger aria-label="Tipo de mantención">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_MAINTENANCE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{IT_MAINTENANCE_TYPE_META[t] ?? t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Fecha" required error={state.fieldErrors?.date?.[0]}>
                  <DatePicker name="date" value={date} onChange={setDate} max={todayInChile()} />
                </Field>
              </div>

              <Field label="Problema reportado">
                <Textarea name="reportedIssue" defaultValue={editMaintenance?.reportedIssue ?? ""} maxLength={500} placeholder="Ej. pantalla no enciende" rows={3} />
              </Field>
              <Field label="Diagnóstico">
                <Textarea name="diagnosis" defaultValue={editMaintenance?.diagnosis ?? ""} maxLength={500} placeholder="Ej. flex dañado" rows={3} />
              </Field>
              <Field label="Trabajo realizado" required error={state.fieldErrors?.workDone?.[0]}>
                <Textarea name="workDone" defaultValue={editMaintenance?.workDone ?? ""} maxLength={1000} placeholder="Ej. reemplazo de pantalla 15.6 FHD" rows={4} />
              </Field>
              <Field label="Repuestos utilizados">
                <Textarea name="partsUsed" defaultValue={editMaintenance?.partsUsed ?? ""} maxLength={500} placeholder="Ej. panel LP156WFH-SPF2" rows={3} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Proveedor">
                  <OptionSelect name="supplierId" defaultValue={editMaintenance?.supplierId ?? ""} emptyLabel="Sin proveedor" placeholder="Sin proveedor" aria-label="Proveedor" options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                </Field>
                <Field label="Técnico responsable">
                  <Input name="technicianName" defaultValue={editMaintenance?.technicianName ?? ""} maxLength={80} placeholder="Nombre del técnico (interno o externo)" />
                </Field>
              </div>

              <Field label="Costo (CLP)">
                <Input name="cost" type="number" defaultValue={editMaintenance?.cost ?? 0} min={0} step={1} placeholder="0" />
              </Field>
              <Field label="Observaciones">
                <Textarea name="observations" defaultValue={editMaintenance?.observations ?? ""} maxLength={500} rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label={isEditing ? "Guardar cambios" : "Registrar mantención"} loadingLabel={isEditing ? "Guardando..." : "Registrando..."} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
