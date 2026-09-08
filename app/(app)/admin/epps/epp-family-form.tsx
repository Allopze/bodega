"use client"

import * as React from "react"
import { useActionState } from "react"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { updateEppFamilyAction } from "./actions"

export interface EppFamilyEditRow {
  id: string
  canonicalName: string
  categoryId: string
  brand: string | null
  model: string | null
  certification: string | null
  lifespanMonths: number | null
  lifespanNotApplicable: boolean
  pictogramUrl: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  family: EppFamilyEditRow | null
  categories: { id: string; name: string }[]
}

export function EppFamilyForm({ open, onClose, family, categories }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await updateEppFamilyAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Familia actualizada")
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  const [notApplicable, setNotApplicable] = React.useState(family?.lifespanNotApplicable ?? false)

  if (!family) return null

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="id" value={family.id} />
          <SheetHeader>
            <div>
              <SheetTitle>{family.canonicalName}</SheetTitle>
              <SheetDescription>Nombre, categoría, marca, modelo, certificación y vida útil de la familia.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              {/* El nombre canónico es lo que se muestra y de lo que se deriva
                  `identityKey`. Las familias que creó el backfill se llaman como
                  uno de sus productos, y sin esto no había cómo corregirlas. */}
              <Field
                label="Nombre de la familia"
                htmlFor="fam-name"
                error={state.fieldErrors?.canonicalName?.[0]}
                helper="Agrupa las variantes. Cambiarlo recalcula la identidad con que el importador deduplica."
              >
                <Input
                  id="fam-name"
                  name="canonicalName"
                  defaultValue={family.canonicalName}
                  error={!!state.fieldErrors?.canonicalName}
                  required
                />
              </Field>

              <Field label="Categoría" htmlFor="fam-category" error={state.fieldErrors?.categoryId?.[0]}>
                <Select name="categoryId" defaultValue={family.categoryId}>
                  <SelectTrigger id="fam-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Marca"
                  htmlFor="fam-brand"
                  error={state.fieldErrors?.brand?.[0]}
                  helper="Junto con el modelo identifica la familia para el importador."
                >
                  <Input
                    id="fam-brand"
                    name="brand"
                    defaultValue={family.brand ?? ""}
                    error={!!state.fieldErrors?.brand}
                    placeholder="3M"
                  />
                </Field>
                <Field label="Modelo" htmlFor="fam-model" error={state.fieldErrors?.model?.[0]}>
                  <Input
                    id="fam-model"
                    name="model"
                    defaultValue={family.model ?? ""}
                    error={!!state.fieldErrors?.model}
                    placeholder="H-700"
                  />
                </Field>
              </div>

              <Field label="Certificación" htmlFor="fam-cert" error={state.fieldErrors?.certification?.[0]}>
                <Input
                  id="fam-cert"
                  name="certification"
                  defaultValue={family.certification ?? ""}
                  error={!!state.fieldErrors?.certification}
                  placeholder="NCh 461"
                />
              </Field>

              <Field
                label="Pictograma (URL)"
                htmlFor="fam-pictogram"
                error={state.fieldErrors?.pictogramUrl?.[0]}
                helper="Imagen del EPP. Aparece en el comprobante de entrega que firma el trabajador."
              >
                <Input
                  id="fam-pictogram"
                  name="pictogramUrl"
                  type="url"
                  defaultValue={family.pictogramUrl ?? ""}
                  error={!!state.fieldErrors?.pictogramUrl}
                  placeholder="https://…"
                />
              </Field>

              <Field
                label="Vida útil (meses)"
                htmlFor="fam-lifespan"
                error={state.fieldErrors?.lifespanMonths?.[0] ?? state.fieldErrors?.lifespanNotApplicable?.[0]}
                helper="Con un valor, Prevención marca como vencido el EPP entregado hace más de ese tiempo. En blanco queda «Sin definir» y se advierte en el listado."
              >
                <div className="space-y-2">
                  <Input
                    id="fam-lifespan"
                    name="lifespanMonths"
                    type="number"
                    min={1}
                    max={600}
                    step={1}
                    defaultValue={family.lifespanMonths != null ? String(family.lifespanMonths) : ""}
                    error={!!state.fieldErrors?.lifespanMonths}
                    className="w-28"
                    disabled={notApplicable}
                  />
                  {/* Distingue la decisión ("este EPP no caduca") del descuido
                      ("nadie lo llenó"), que antes se veían igual. */}
                  <Checkbox
                    name="lifespanNotApplicable"
                    value="true"
                    label="Este EPP no vence por diseño"
                    checked={notApplicable}
                    onChange={(e) => setNotApplicable(e.target.checked)}
                  />
                </div>
              </Field>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
