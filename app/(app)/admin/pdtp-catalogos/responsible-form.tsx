"use client"

import * as React from "react"
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
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { PDTP_RESPONSIBLE_KIND_LABELS, type PdtpResponsibleKind } from "@/lib/prevention/pdtp"
import { savePdtpResponsibleAction } from "./actions"

export interface ResponsibleRow {
  slug: string
  displayName: string
  roleName: string
  kind: string
  notes: string
  isActive: boolean
}

interface ResponsibleFormProps {
  open: boolean
  onClose: () => void
  editResponsible?: ResponsibleRow | null
  /** Slugs de rol reales, derivados del registry de módulos (ver `SheetForm`,
   *  que usa la misma prop para su checklist de roles con acceso). */
  roleOptions: string[]
}

const KIND_OPTIONS = Object.keys(PDTP_RESPONSIBLE_KIND_LABELS) as PdtpResponsibleKind[]

// Radix Select prohíbe `value=""` en un SelectItem (la cadena vacía está
// reservada para limpiar la selección). Usarla lanza en cliente y tumba la
// pantalla. El centinela es sólo para Radix: el valor enviado sigue siendo "".
const NONE = "_none"

export function ResponsibleForm({ open, onClose, editResponsible, roleOptions }: ResponsibleFormProps) {
  const isEdit = !!editResponsible

  const [kind, setKind] = React.useState(editResponsible?.kind ?? "rol_rbac")
  const [roleName, setRoleName] = React.useState(editResponsible?.roleName ?? "")

  // Un responsable ya creado puede apuntar a un rol que dejó de ser un
  // default-grant vigente del registry (roleOptions cambia con los módulos
  // habilitados). Si el Select sólo mostrara roleOptions, guardar de nuevo
  // borraría en silencio ese vínculo histórico — se inyecta la opción,
  // rotulada como heredada, igual que se hizo con las plantillas retiradas
  // en el precedente de Inspecciones.
  const roleSelectOptions = roleName && !roleOptions.includes(roleName)
    ? [roleName, ...roleOptions]
    : roleOptions

  // La columna `kind` no tiene una constraint en la base de datos: la lista de
  // 4 valores es sólo una convención de esta pantalla. Si algún responsable
  // existente quedó con un valor fuera de esa convención, mostrarlo igual
  // (marcado) en vez de que el Select se vea vacío sin explicación.
  const kindSelectOptions: string[] = KIND_OPTIONS.includes(kind as PdtpResponsibleKind)
    ? KIND_OPTIONS
    : [kind, ...KIND_OPTIONS]

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
              <SheetDescription>Identificador, nombre visible y tipo de responsable.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Identificador interno" htmlFor="resp-slug" required error={state.fieldErrors?.slug?.[0]} helper="Sin espacios ni tildes (ej: jefe_terreno). No se puede modificar después.">
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
              <Field label="Tipo" htmlFor="resp-kind" required error={state.fieldErrors?.kind?.[0]}>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="resp-kind" aria-label="Tipo" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {kindSelectOptions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PDTP_RESPONSIBLE_KIND_LABELS[value as PdtpResponsibleKind] ?? `${value} (heredado)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <input type="hidden" name="kind" value={kind} />
              <Field label="Rol del sistema relacionado (opcional)" htmlFor="resp-role" error={state.fieldErrors?.roleName?.[0]}>
                <Select value={roleName || NONE} onValueChange={(value) => setRoleName(value === NONE ? "" : value)}>
                  <SelectTrigger id="resp-role" aria-label="Rol del sistema relacionado" className="w-full"><SelectValue placeholder="Sin rol asociado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sin rol asociado</SelectItem>
                    {roleSelectOptions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}{!roleOptions.includes(value) ? " (heredado)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <input type="hidden" name="roleName" value={roleName} />
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
