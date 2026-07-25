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
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { savePdtpSheetAction } from "./actions"

export interface SheetRow {
  id: string
  code: string
  programId: string
  label: string
  area: string
  defaultScopeRoles: string[]
  isActive: boolean
}
export interface ProgramOption {
  id: string
  year: number
  version: number
  status: string
  title: string
}

interface SheetFormProps {
  open: boolean
  onClose: () => void
  editSheet?: SheetRow | null
  programs: ProgramOption[]
  roleOptions: string[]
}

// Radix Select prohíbe `value=""` en un SelectItem (la cadena vacía está
// reservada para limpiar la selección). Usarla lanza en cliente y tumba la
// pantalla. El centinela es sólo para Radix: el valor enviado sigue siendo "".
const NONE = "_none"

export function SheetForm({ open, onClose, editSheet, programs, roleOptions }: SheetFormProps) {
  const isEdit = !!editSheet

  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(editSheet?.defaultScopeRoles ?? []),
  )
  const [programId, setProgramId] = React.useState(editSheet?.programId ?? "")

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await savePdtpSheetAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Hoja guardada")
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
          {isEdit && <input type="hidden" name="id" value={editSheet!.id} />}
          {/* Comma-separated hidden input so the server action receives the selected role slugs. */}
          <input
            type="hidden"
            name="defaultScopeRoles"
            value={roleOptions.filter((r) => selected.has(r)).join(",")}
          />
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar hoja" : "Nueva hoja"}</SheetTitle>
              <SheetDescription>Código, etiqueta, área y roles con acceso predeterminado.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Código" htmlFor="sht-code" required error={state.fieldErrors?.code?.[0]}>
                  <Input
                    id="sht-code"
                    name="code"
                    defaultValue={editSheet?.code ?? ""}
                    error={!!state.fieldErrors?.code}
                  />
                </Field>
                <Field label="Área" htmlFor="sht-area" required error={state.fieldErrors?.area?.[0]}>
                  <Input
                    id="sht-area"
                    name="area"
                    defaultValue={editSheet?.area ?? ""}
                    error={!!state.fieldErrors?.area}
                  />
                </Field>
              </div>
              <Field label="Etiqueta" htmlFor="sht-label" required error={state.fieldErrors?.label?.[0]}>
                <Input
                  id="sht-label"
                  name="label"
                  defaultValue={editSheet?.label ?? ""}
                  error={!!state.fieldErrors?.label}
                />
              </Field>
              <Field label="Programa (opcional)" htmlFor="sht-prog" error={state.fieldErrors?.programId?.[0]} helper="Vacío para hoja plantilla global.">
                <Select value={programId || NONE} onValueChange={(v) => setProgramId(v === NONE ? "" : v)}>
                  <SelectTrigger id="sht-prog" className="h-9 w-full">
                    <SelectValue placeholder="— Hoja plantilla global —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Hoja plantilla global —</SelectItem>
                    {programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title} · {p.year} v{p.version} ({p.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="programId" value={programId} />
              </Field>
              <div>
                <p className="text-eyebrow mb-2">Roles con acceso predeterminado</p>
                <div className="space-y-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  {roleOptions.map((r) => (
                    <label key={r} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--color-surface)]">
                      <input
                        type="checkbox"
                        checked={selected.has(r)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(r)) next.delete(r)
                            else next.add(r)
                            return next
                          })
                        }}
                      />
                      <span className="font-mono text-xs">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear hoja"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
