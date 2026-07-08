"use client"

import { useActionState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { savePdtpResponsibleAction } from "./actions"

export interface ResponsibleRow {
  slug: string
  displayName: string
  roleName: string
  kind: string
  notes: string
}

interface ResponsibleFormProps {
  open: boolean
  onClose: () => void
  editResponsible?: ResponsibleRow | null
}

export function ResponsibleForm({ open, onClose, editResponsible }: ResponsibleFormProps) {
  const isEdit = !!editResponsible

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await savePdtpResponsibleAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Responsable guardado")
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {isEdit && <input type="hidden" name="id" value={editResponsible!.slug} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar responsable" : "Nuevo responsable"}</SheetTitle>
              <SheetDescription>Slug, nombre visible y tipo de responsable.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Slug" htmlFor="resp-slug" required error={state.fieldErrors?.slug?.[0]} helper="Identificador interno (snake_case). Inmutable.">
                <Input
                  id="resp-slug"
                  name="slug"
                  defaultValue={editResponsible?.slug ?? ""}
                  disabled={isEdit}
                  error={!!state.fieldErrors?.slug}
                />
              </Field>
              <Field label="Nombre visible" htmlFor="resp-name" required error={state.fieldErrors?.displayName?.[0]}>
                <Input
                  id="resp-name"
                  name="displayName"
                  defaultValue={editResponsible?.displayName ?? ""}
                  error={!!state.fieldErrors?.displayName}
                />
              </Field>
              <Field label="Tipo (kind)" htmlFor="resp-kind" required error={state.fieldErrors?.kind?.[0]} helper="rol_rbac | grupo | persona | otro">
                <Input
                  id="resp-kind"
                  name="kind"
                  defaultValue={editResponsible?.kind ?? "rol_rbac"}
                  error={!!state.fieldErrors?.kind}
                />
              </Field>
              <Field label="Rol RBAC relacionado (opcional)" htmlFor="resp-role" error={state.fieldErrors?.roleName?.[0]}>
                <Input
                  id="resp-role"
                  name="roleName"
                  defaultValue={editResponsible?.roleName ?? ""}
                  error={!!state.fieldErrors?.roleName}
                  placeholder="ej: jefe_terreno"
                />
              </Field>
              <Field label="Notas" htmlFor="resp-notes" error={state.fieldErrors?.notes?.[0]}>
                <Input
                  id="resp-notes"
                  name="notes"
                  defaultValue={editResponsible?.notes ?? ""}
                  error={!!state.fieldErrors?.notes}
                />
              </Field>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear responsable"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
