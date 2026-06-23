"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "@/lib/toast"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { createWorker, updateWorker } from "./actions"

interface WorksiteOption { id: string; name: string }

interface WorkerForEdit {
  id:         string
  rut:        string | null
  firstName:  string
  lastName:   string
  position:   string | null
  worksiteId: string
  isActive:   boolean
}

interface WorkerFormProps {
  open:        boolean
  onClose:     () => void
  editWorker?: WorkerForEdit | null
  worksites:   WorksiteOption[]
}

export function WorkerForm({ open, onClose, editWorker, worksites }: WorkerFormProps) {
  const isEdit = !!editWorker
  const action = isEdit ? updateWorker : createWorker
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const [selectedWorksiteId, setSelectedWorksiteId] = useState(editWorker?.worksiteId ?? "")

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Trabajador actualizado" : "Trabajador creado"))
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {isEdit && <input type="hidden" name="id" value={editWorker.id} />}

          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar trabajador" : "Nuevo trabajador"}</SheetTitle>
              <SheetDescription>
                {isEdit
                  ? `Modificar ${editWorker.firstName} ${editWorker.lastName}`
                  : "Registra un trabajador para asignación de EPP y entregas"}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nombre" htmlFor="wrk-first" required error={state.fieldErrors?.firstName?.[0]}>
                  <Input
                    id="wrk-first" name="firstName"
                    defaultValue={editWorker?.firstName ?? ""}
                    placeholder="Juan"
                    error={!!state.fieldErrors?.firstName}
                  />
                </Field>
                <Field label="Apellido" htmlFor="wrk-last" required error={state.fieldErrors?.lastName?.[0]}>
                  <Input
                    id="wrk-last" name="lastName"
                    defaultValue={editWorker?.lastName ?? ""}
                    placeholder="Pérez"
                    error={!!state.fieldErrors?.lastName}
                  />
                </Field>
              </div>

              <Field label="RUT" htmlFor="wrk-rut" helper="Formato: 12345678-9" error={state.fieldErrors?.rut?.[0]}>
                <Input
                  id="wrk-rut" name="rut"
                  defaultValue={editWorker?.rut ?? ""}
                  placeholder="12345678-9"
                  error={!!state.fieldErrors?.rut}
                  className="font-mono"
                />
              </Field>

              <Field label="Cargo" htmlFor="wrk-pos">
                <Input
                  id="wrk-pos" name="position"
                  defaultValue={editWorker?.position ?? ""}
                  placeholder="Operario, Supervisor, Técnico..."
                />
              </Field>

              <Field label="Faena" htmlFor="wrk-ws" required error={state.fieldErrors?.worksiteId?.[0]}>
                {/* Hidden input carries value to FormData / server action */}
                <input type="hidden" name="worksiteId" value={selectedWorksiteId} />
                <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}>
                  <SelectTrigger id="wrk-ws" error={!!state.fieldErrors?.worksiteId?.[0]}>
                    <SelectValue placeholder="Selecciona una faena" />
                  </SelectTrigger>
                  <SelectContent>
                    {worksites.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Checkbox id="wrk-isActive" name="isActive" value="on" defaultChecked={editWorker?.isActive ?? true} label="Trabajador activo" />
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear trabajador"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
