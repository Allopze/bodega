"use client"

import { useActionState, useEffect } from "react"
import * as React from "react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toCode } from "@/lib/utils"
import { createCostCenter, updateCostCenter } from "./actions"

interface Worksite { id: string; name: string }
interface CostCenterForEdit {
  id:          string
  name:        string
  code:        string
  worksiteId:  string
  isActive:    boolean
}

interface CostCenterFormProps {
  open:             boolean
  onClose:          () => void
  editCostCenter?:  CostCenterForEdit | null
  worksites:        Worksite[]
  defaultWorksiteId?: string
}

export function CostCenterForm({ open, onClose, editCostCenter, worksites, defaultWorksiteId }: CostCenterFormProps) {
  const isEdit = !!editCostCenter
  const action = isEdit ? updateCostCenter : createCostCenter
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const [code, changeCode] = React.useReducer((_current: string, next: string) => next, editCostCenter?.code ?? "")
  const [worksiteId, changeWorksiteId] = React.useReducer(
    (_current: string, next: string) => next,
    editCostCenter?.worksiteId ?? defaultWorksiteId ?? "",
  )

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Centro actualizado" : "Centro creado"))
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    changeCode(editCostCenter?.code ?? "")
    changeWorksiteId(editCostCenter?.worksiteId ?? defaultWorksiteId ?? "")
  }, [editCostCenter?.id, defaultWorksiteId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction}>
          {isEdit && <input type="hidden" name="id" value={editCostCenter.id} />}
          <input type="hidden" name="worksiteId" value={worksiteId} />

          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar centro de costo" : "Nuevo centro de costo"}</SheetTitle>
              <SheetDescription>
                {isEdit ? `Modificar ${editCostCenter.name}` : "Registra un nuevo centro de costo"}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Faena" htmlFor="cc-worksite" required error={state.fieldErrors?.worksiteId?.[0]}>
                <Select value={worksiteId} onValueChange={changeWorksiteId}>
                  <SelectTrigger id="cc-worksite" error={!!state.fieldErrors?.worksiteId}>
                    <SelectValue placeholder="Seleccionar faena..." />
                  </SelectTrigger>
                  <SelectContent>
                    {worksites.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Nombre" htmlFor="cc-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="cc-name" name="name"
                  defaultValue={editCostCenter?.name ?? ""}
                  placeholder="Administración"
                  error={!!state.fieldErrors?.name}
                  onChange={(e) => { if (!isEdit) changeCode(toCode(e.target.value)) }}
                />
              </Field>

              <Field label="Código" htmlFor="cc-code" required error={state.fieldErrors?.code?.[0]}>
                <Input
                  id="cc-code" name="code"
                  value={code}
                  onChange={(e) => changeCode(e.target.value.toUpperCase())}
                  placeholder="ADM"
                  error={!!state.fieldErrors?.code}
                  className="font-mono"
                />
              </Field>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="cc-isActive" name="isActive" value="on" defaultChecked={editCostCenter?.isActive ?? true} className="h-4 w-4 accent-[var(--color-primary)]" />
                <label htmlFor="cc-isActive" className="text-sm text-[var(--color-text)]">Centro activo</label>
              </div>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear centro"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
