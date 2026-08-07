"use client"

import { useActionState, useState } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { saveAttributeTemplateAction } from "./actions"
import { ATTRIBUTE_TYPE_OPTIONS } from "@/lib/validation/product-catalogs"

export interface AttributeTemplateRow {
  id: string
  categoryId: string
  name: string
  type: string
  options: string
  isRequired: boolean
  sortOrder: number
  isActive: boolean
  categoryName?: string
}

interface AttributeTemplateFormProps {
  open: boolean
  onClose: () => void
  editTemplate?: AttributeTemplateRow | null
  categories: { id: string; name: string }[]
}

function optionsAsLines(json: string | undefined): string {
  if (!json) return ""
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).join("\n")
    return json
  } catch {
    return json.replace(/\s*,\s*/g, "\n")
  }
}

export function AttributeTemplateForm({ open, onClose, editTemplate, categories }: AttributeTemplateFormProps) {
  const isEdit = !!editTemplate
  const [type, setType] = useState(editTemplate?.type ?? "text")
  const [categoryId, setCategoryId] = useState(editTemplate?.categoryId || "__all__")
  const isSelectType = type === "select"

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveAttributeTemplateAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Plantilla guardada")
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
          {isEdit && <input type="hidden" name="id" value={editTemplate!.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar plantilla" : "Nueva plantilla"}</SheetTitle>
              <SheetDescription>Nombre, tipo y reglas opcionales para el atributo reutilizable.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Nombre" htmlFor="attr-name" required error={state.fieldErrors?.name?.[0]}>
                <Input id="attr-name" name="name" defaultValue={editTemplate?.name ?? ""} error={!!state.fieldErrors?.name} />
              </Field>
              <Field label="Tipo" htmlFor="attr-type" required error={state.fieldErrors?.type?.[0]}>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="attr-type" error={!!state.fieldErrors?.type}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTE_TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="type" value={type} />
              </Field>
              <Field label="Categoría" htmlFor="attr-cat" error={state.fieldErrors?.categoryId?.[0]} helper="Vacío para reutilizarla en cualquier categoría.">
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="attr-cat" error={!!state.fieldErrors?.categoryId}>
                    <SelectValue placeholder="Todas las categorías" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas las categorías</SelectItem>
                    {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="categoryId" value={categoryId === "__all__" ? "" : categoryId} />
              </Field>
              {isSelectType && (
                <Field label="Opciones (una por línea)" htmlFor="attr-options" required error={state.fieldErrors?.optionsText?.[0]}>
                  <Textarea
                    id="attr-options"
                    name="optionsText"
                    rows={5}
                    defaultValue={optionsAsLines(editTemplate?.options)}
                    aria-label="Opciones (una por línea)"
                  />
                </Field>
              )}
              <Field label="Orden" htmlFor="attr-order" error={state.fieldErrors?.sortOrder?.[0]} helper="Entero ascendente.">
                <Input id="attr-order" name="sortOrder" type="number" min={0} step={1} defaultValue={String(editTemplate?.sortOrder ?? 0)} error={!!state.fieldErrors?.sortOrder} className="w-24" />
              </Field>
              <Checkbox id="attr-required" name="isRequired" value="on" defaultChecked={editTemplate?.isRequired ?? false} label="Requerido" />
              <Checkbox id="attr-active" name="isActive" value="on" defaultChecked={editTemplate?.isActive ?? true} label="Plantilla activa" />
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear plantilla"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
