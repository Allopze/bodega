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
import { createAssetAction, updateAssetAction } from "./actions"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import type { ItAssetFormData } from "@/lib/validation/ti"

interface AssetFormSheetProps {
  trigger: React.ReactNode
  assetTypes: { id: string; name: string; category: string; hasSpecs: boolean; isActive?: boolean }[]
  suppliers: { id: string; name: string }[]
  worksites: { id: string; name: string }[]
  /** Modo edición: activo existente. */
  editAsset?: ItAssetFormData & { id: string }
}

const EMPTY_FORM: Record<string, string> = {}

export function AssetFormSheet({ trigger, assetTypes, suppliers, worksites, editAsset }: AssetFormSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [typeId, setTypeId] = React.useState(editAsset?.assetTypeId ?? "")
  const action = editAsset ? updateAssetAction : createAssetAction
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? (editAsset ? "Activo actualizado" : "Activo creado"))
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const selectedType = assetTypes.find((t) => t.id === typeId)
  const showSpecs = Boolean(selectedType?.hasSpecs)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {editAsset && <input type="hidden" name="id" value={editAsset.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{editAsset ? `Editar ${editAsset.code}` : "Nuevo activo"}</SheetTitle>
              <SheetDescription>
                {editAsset ? "Actualiza los datos del activo. El historial se conserva." : "Registra un activo tecnológico en el inventario."}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Código interno" required error={state.fieldErrors?.code?.[0]}>
                  <Input name="code" defaultValue={editAsset?.code ?? EMPTY_FORM["code"]} placeholder="TI-NB-0042" maxLength={40} />
                </Field>
                <Field label="Tipo de activo" required error={state.fieldErrors?.assetTypeId?.[0]}>
                  <Select
                    value={typeId}
                    onValueChange={setTypeId}
                  >
                    <SelectTrigger aria-label="Tipo de activo">
                      <SelectValue placeholder="Selecciona el tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {assetTypes.filter((t) => t.isActive !== false).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="assetTypeId" value={typeId} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Marca">
                  <Input name="brand" defaultValue={editAsset?.brand ?? ""} maxLength={80} />
                </Field>
                <Field label="Modelo">
                  <Input name="model" defaultValue={editAsset?.model ?? ""} maxLength={80} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Número de serie" helper="Único por equipo. Déjalo vacío si no aplica.">
                  <Input name="serialNumber" defaultValue={editAsset?.serialNumber ?? ""} maxLength={80} />
                </Field>
                <Field label={editAsset ? "Estado actual" : "Estado inicial"} error={state.fieldErrors?.status?.[0]}>
                  <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)]">
                    {editAsset ? (IT_ASSET_STATUS_META[editAsset.status]?.label ?? editAsset.status) : "Disponible"}
                  </p>
                  {!editAsset && <input type="hidden" name="status" value="disponible" />}
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {editAsset ? "Los cambios de estado se registran desde la ficha del activo." : "La custodia y las bajas cambian el estado mediante sus flujos registrados."}
                  </p>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Faena" helper="Faena u oficina donde se ubica (opcional).">
                  <OptionSelect name="worksiteId" defaultValue={editAsset?.worksiteId ?? ""} emptyLabel="Sin faena" placeholder="Sin faena asignada" aria-label="Faena" options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))} />
                </Field>
                <Field label="Ubicación" helper="Oficina, bodega o detalle libre.">
                  <Input name="location" defaultValue={editAsset?.location ?? ""} maxLength={120} />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Fecha de compra">
                  <DatePicker name="purchaseDate" defaultValue={editAsset?.purchaseDate ?? ""} placeholder="Sin fecha" />
                </Field>
                <Field label="Proveedor">
                  <OptionSelect name="supplierId" defaultValue={editAsset?.supplierId ?? ""} emptyLabel="Sin proveedor" placeholder="Sin proveedor" aria-label="Proveedor" options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                </Field>
                <Field label="Costo (CLP)">
                  <Input name="cost" type="number" min={0} step={1} defaultValue={editAsset?.cost != null ? String(editAsset.cost) : ""} placeholder="0" />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Documento de compra">
                  <OptionSelect
                    name="purchaseDocType"
                    defaultValue={editAsset?.purchaseDocType ?? ""}
                    emptyLabel="Sin documento"
                    placeholder="Sin documento"
                    aria-label="Tipo de documento"
                    options={[{ value: "factura", label: "Factura" }, { value: "oc", label: "Orden de compra" }, { value: "otro", label: "Otro" }]}
                  />
                </Field>
                <Field label="Nº documento">
                  <Input name="purchaseDocRef" defaultValue={editAsset?.purchaseDocRef ?? ""} maxLength={80} />
                </Field>
                <Field label="Fin de garantía">
                  <DatePicker name="warrantyEndDate" defaultValue={editAsset?.warrantyEndDate ?? ""} placeholder="Sin garantía" />
                </Field>
              </div>

              {showSpecs && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Especificaciones técnicas</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Procesador">
                      <Input name="processor" defaultValue={editAsset?.processor ?? ""} maxLength={80} placeholder="Intel Core i5-1235U" />
                    </Field>
                    <Field label="RAM">
                      <Input name="ram" defaultValue={editAsset?.ram ?? ""} maxLength={40} placeholder="16 GB" />
                    </Field>
                    <Field label="Almacenamiento">
                      <Input name="storage" defaultValue={editAsset?.storage ?? ""} maxLength={80} placeholder="512 GB SSD" />
                    </Field>
                    <Field label="Sistema operativo">
                      <Input name="os" defaultValue={editAsset?.os ?? ""} maxLength={80} placeholder="Windows 11 Pro" />
                    </Field>
                  </div>
                </div>
              )}

              <Field label="Observaciones">
                <Input name="observations" defaultValue={editAsset?.observations ?? ""} maxLength={500} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label={editAsset ? "Guardar cambios" : "Crear activo"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
