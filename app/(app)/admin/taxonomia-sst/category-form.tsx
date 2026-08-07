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
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { saveDocumentCategoryAction } from "./actions"
import type { CategoryRow } from "./taxonomy-list"

interface CategoryFormProps {
  open: boolean
  onClose: () => void
  editCategory?: CategoryRow | null
}

export function CategoryForm({ open, onClose, editCategory }: CategoryFormProps) {
  const isEdit = !!editCategory

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveDocumentCategoryAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Categoría guardada")
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
          {isEdit && <input type="hidden" name="slug" value={editCategory!.slug} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar categoría" : "Nueva categoría"}</SheetTitle>
              <SheetDescription>
                Define el código slug (snake_case), el nombre visible y el orden de aparición.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Slug" htmlFor="cat-slug" required error={state.fieldErrors?.slug?.[0]} helper="Identificador interno (snake_case).">
                <Input
                  id="cat-slug"
                  name="slug"
                  defaultValue={editCategory?.slug ?? ""}
                  error={!!state.fieldErrors?.slug}
                  placeholder="gestion_preventiva"
                  disabled={isEdit}
                />
              </Field>
              <Field label="Nombre" htmlFor="cat-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="cat-name"
                  name="name"
                  defaultValue={editCategory?.name ?? ""}
                  error={!!state.fieldErrors?.name}
                />
              </Field>
              <Field label="Descripción" htmlFor="cat-desc" error={state.fieldErrors?.description?.[0]}>
                <Input
                  id="cat-desc"
                  name="description"
                  defaultValue={editCategory?.description ?? ""}
                  error={!!state.fieldErrors?.description}
                />
              </Field>
              <Field label="Orden" htmlFor="cat-order" error={state.fieldErrors?.sortOrder?.[0]} helper="Número entero: orden ascendente en listados.">
                <Input
                  id="cat-order"
                  name="sortOrder"
                  type="number"
                  defaultValue={String(editCategory?.sortOrder ?? 0)}
                  error={!!state.fieldErrors?.sortOrder}
                  className="w-24"
                />
              </Field>
              <Checkbox
                id="cat-active"
                name="isActive"
                value="on"
                defaultChecked={editCategory?.isActive ?? true}
                label="Categoría activa"
              />
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear categoría"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
