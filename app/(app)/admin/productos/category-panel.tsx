"use client"

import { useActionState, useEffect } from "react"
import * as React from "react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toCode } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { createCategory, updateCategory } from "./actions"

export interface CategoryForEdit {
  id: string; name: string; slug: string
  isEpp: boolean; requiresPrevencion: boolean; sortOrder: number
}

interface CategoryPanelProps {
  open:        boolean
  onClose:     () => void
  editCategory?: CategoryForEdit | null
}

export function CategoryPanel({ open, onClose, editCategory }: CategoryPanelProps) {
  const isEdit = !!editCategory
  const action = isEdit ? updateCategory : createCategory
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const [slug, changeSlug] = React.useReducer((_current: string, next: string) => next, editCategory?.slug ?? "")

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Categoría actualizada" : "Categoría creada"))
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => { changeSlug(editCategory?.slug ?? "") }, [editCategory?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction}>
          {isEdit && <input type="hidden" name="id" value={editCategory.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar categoría" : "Nueva categoría"}</SheetTitle>
              <SheetDescription>Categorías del catálogo de productos</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Nombre" htmlFor="cat-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="cat-name" name="name"
                  defaultValue={editCategory?.name ?? ""}
                  placeholder="Herramientas manuales"
                  error={!!state.fieldErrors?.name}
                  onChange={(e) => { if (!isEdit) changeSlug(toCode(e.target.value).toLowerCase().replace(/-+/g, "-")) }}
                />
              </Field>
              <Field label="Slug" htmlFor="cat-slug" required helper="Identificador único del sistema" error={state.fieldErrors?.slug?.[0]}>
                <Input
                  id="cat-slug" name="slug"
                  value={slug}
                  onChange={(e) => changeSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  placeholder="herramientas-manuales"
                  error={!!state.fieldErrors?.slug}
                  className="font-mono"
                />
              </Field>
              <Field label="Orden" htmlFor="cat-sort" helper="Número de orden en la lista (menor = primero)">
                <Input id="cat-sort" name="sortOrder" type="number" defaultValue={editCategory?.sortOrder ?? 0} className="w-24" />
              </Field>
              <div className="space-y-2">
                <Checkbox id="cat-epp" name="isEpp" value="on" defaultChecked={editCategory?.isEpp ?? false} label="Es EPP (equipo de protección personal)" />
                <Checkbox id="cat-prev" name="requiresPrevencion" value="on" defaultChecked={editCategory?.requiresPrevencion ?? false} label="Requiere aprobación de Prevención" />
              </div>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar" : "Crear categoría"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
