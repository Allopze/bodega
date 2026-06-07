"use client"

import { useActionState, useEffect } from "react"
import * as React from "react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toCode } from "@/lib/utils"
import { createWarehouse, updateWarehouse } from "./actions"

interface Worksite { id: string; name: string }
interface WarehouseForEdit {
  id: string; name: string; code: string; type: string
  worksiteId: string | null; address: string | null; notes: string | null; isActive: boolean
}

const WAREHOUSE_TYPES = [
  { value: "central",   label: "Central" },
  { value: "worksite",  label: "Faena" },
  { value: "transit",   label: "Tránsito" },
]

interface WarehouseFormProps {
  open:             boolean
  onClose:          () => void
  editWarehouse?:   WarehouseForEdit | null
  worksites:        Worksite[]
}

export function WarehouseForm({ open, onClose, editWarehouse, worksites }: WarehouseFormProps) {
  const isEdit = !!editWarehouse
  const action = isEdit ? updateWarehouse : createWarehouse
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const [code, changeCode] = React.useReducer((_current: string, next: string) => next, editWarehouse?.code ?? "")
  const [type, changeType] = React.useReducer((_current: string, next: string) => next, editWarehouse?.type ?? "central")
  const [worksiteId, changeWorksiteId] = React.useReducer(
    (_current: string, next: string) => next,
    editWarehouse?.worksiteId ?? "",
  )

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Bodega actualizada" : "Bodega creada"))
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    changeCode(editWarehouse?.code ?? "")
    changeType(editWarehouse?.type ?? "central")
    changeWorksiteId(editWarehouse?.worksiteId ?? "")
  }, [editWarehouse?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction}>
          {isEdit && <input type="hidden" name="id" value={editWarehouse.id} />}
          <input type="hidden" name="type"       value={type} />
          <input type="hidden" name="worksiteId" value={worksiteId} />

          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar bodega" : "Nueva bodega"}</SheetTitle>
              <SheetDescription>
                {isEdit ? `Modificar ${editWarehouse.name}` : "Registra una nueva bodega"}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Nombre" htmlFor="wh-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="wh-name" name="name"
                  defaultValue={editWarehouse?.name ?? ""}
                  placeholder="Bodega Central Santiago"
                  error={!!state.fieldErrors?.name}
                  onChange={(e) => { if (!isEdit) changeCode(toCode(e.target.value)) }}
                />
              </Field>

              <Field label="Código" htmlFor="wh-code" required error={state.fieldErrors?.code?.[0]}>
                <Input
                  id="wh-code" name="code"
                  value={code}
                  onChange={(e) => changeCode(e.target.value.toUpperCase())}
                  placeholder="BOD-CENTRAL"
                  error={!!state.fieldErrors?.code}
                  className="font-mono"
                />
              </Field>

              <Field label="Tipo" htmlFor="wh-type" required error={state.fieldErrors?.type?.[0]}>
                <Select value={type} onValueChange={changeType}>
                  <SelectTrigger id="wh-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WAREHOUSE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {type === "worksite" && (
                <Field label="Faena asociada" htmlFor="wh-ws" error={state.fieldErrors?.worksiteId?.[0]}>
                  <Select value={worksiteId} onValueChange={changeWorksiteId}>
                    <SelectTrigger id="wh-ws">
                      <SelectValue placeholder="Seleccionar faena..." />
                    </SelectTrigger>
                    <SelectContent>
                      {worksites.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field label="Dirección" htmlFor="wh-address">
                <Input id="wh-address" name="address" defaultValue={editWarehouse?.address ?? ""} placeholder="Dirección de la bodega..." />
              </Field>

              <Field label="Notas" htmlFor="wh-notes">
                <Textarea id="wh-notes" name="notes" defaultValue={editWarehouse?.notes ?? ""} placeholder="Capacidad, restricciones..." rows={2} />
              </Field>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="wh-isActive" name="isActive" value="on" defaultChecked={editWarehouse?.isActive ?? true} className="h-4 w-4 accent-[var(--color-primary)]" />
                <label htmlFor="wh-isActive" className="text-sm text-[var(--color-text)]">Bodega activa</label>
              </div>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear bodega"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
