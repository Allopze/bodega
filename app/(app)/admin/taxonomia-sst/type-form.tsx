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
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { SST_DOCUMENT_CONFIDENTIALITIES } from "@/lib/validation/prevention-module/sst-documents"
import { saveDocumentTypeAction } from "./actions"
import { CONFIDENTIALITY_LABEL, withCurrentCategory, type CategoryOption } from "./labels"
import type { TypeRow } from "./taxonomy-list"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

interface TypeFormProps {
  open: boolean
  onClose: () => void
  editType?: TypeRow | null
  categorySlug: string
  categoryOptions: CategoryOption[]
  catalogActivities: PdtpActivityPickerOption[]
}

export function TypeForm({ open, onClose, editType, categorySlug, categoryOptions, catalogActivities }: TypeFormProps) {
  const isEdit = !!editType
  const initialCategory = editType?.categorySlug ?? categorySlug
  // La categoría de un tipo creado en una custom ya no listada debe seguir
  // existiendo en el selector al editar: se agrega desde el propio registro en
  // vez de resetear el valor.
  const options = withCurrentCategory(categoryOptions, initialCategory)
  const [catSlug, setCatSlug] = React.useState(
    initialCategory && options.some((o) => o.slug === initialCategory) ? initialCategory : (options[0]?.slug ?? ""),
  )
  const [defaultConf, setDefaultConf] = React.useState(editType?.defaultConfidentiality ?? "publico_interno")
  const [publishActivities, setPublishActivities] = React.useState(editType?.pdtpCatalogActivityIds ?? [])
  const [ackActivities, setAckActivities] = React.useState(editType?.pdtpAcknowledgmentCatalogActivityIds ?? [])

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveDocumentTypeAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Tipo guardado")
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
          {isEdit && <input type="hidden" name="id" value={editType!.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar tipo" : "Nuevo tipo"}</SheetTitle>
              <SheetDescription>
                Define el código, confidencialidad predeterminada y reglas de aprobación.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field label="Categoría" htmlFor="type-cat" required error={state.fieldErrors?.categorySlug?.[0]}>
                <Select value={catSlug} onValueChange={setCatSlug}>
                  <SelectTrigger id="type-cat" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((opt) => (
                      <SelectItem key={opt.slug} value={opt.slug}>{opt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="categorySlug" value={catSlug} />
              </Field>
              <Field label="Código" htmlFor="type-code" required error={state.fieldErrors?.code?.[0]}>
                <Input
                  id="type-code"
                  name="code"
                  defaultValue={editType?.code ?? ""}
                  error={!!state.fieldErrors?.code}
                  placeholder="MD-001"
                />
              </Field>
              <Field label="Nombre" htmlFor="type-name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="type-name"
                  name="name"
                  defaultValue={editType?.name ?? ""}
                  error={!!state.fieldErrors?.name}
                />
              </Field>
              <Field label="Descripción" htmlFor="type-desc" error={state.fieldErrors?.description?.[0]}>
                <Input
                  id="type-desc"
                  name="description"
                  defaultValue={editType?.description ?? ""}
                  error={!!state.fieldErrors?.description}
                />
              </Field>
              <Field label="Confidencialidad" htmlFor="type-conf" error={state.fieldErrors?.defaultConfidentiality?.[0]}>
                <Select value={defaultConf} onValueChange={setDefaultConf}>
                  <SelectTrigger id="type-conf" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SST_DOCUMENT_CONFIDENTIALITIES.map((conf) => (
                      <SelectItem key={conf} value={conf}>{CONFIDENTIALITY_LABEL[conf] ?? conf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="defaultConfidentiality" value={defaultConf} />
              </Field>
              <Field label="Vigencia por defecto (meses)" htmlFor="type-validity" error={state.fieldErrors?.defaultValidityMonths?.[0]} helper="Opcional: meses hasta vencimiento si aplica.">
                <Input
                  id="type-validity"
                  name="defaultValidityMonths"
                  type="number"
                  defaultValue={editType?.defaultValidityMonths?.toString() ?? ""}
                  error={!!state.fieldErrors?.defaultValidityMonths}
                  className="w-32"
                />
              </Field>
              <Checkbox
                id="type-approval"
                name="requiresApproval"
                value="on"
                defaultChecked={editType?.requiresApproval ?? true}
                label="Requiere aprobación administrativa"
              />
              <p className="-mt-1 text-xs text-[var(--color-text-muted)]">
                Sin aprobación, cada versión queda vigente al cargarla: úsalo sólo para registros externos (una carta timbrada, un certificado).
              </p>
              <Field
                label="Plazo de entrega a la dotación (días)"
                htmlFor="type-distribution-days"
                error={state.fieldErrors?.distributionDueDays?.[0]}
                helper="Opcional. Con plazo, cada versión vigente se asigna a toda la dotación de cada faena para su acuse (el RIOHS abre la entrega N°18 del programa preventivo)."
              >
                <Input
                  id="type-distribution-days"
                  name="distributionDueDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={editType?.distributionDueDays?.toString() ?? ""}
                  error={!!state.fieldErrors?.distributionDueDays}
                  className="w-32"
                />
              </Field>
              <Checkbox
                id="type-ack"
                name="requiresAcknowledgment"
                value="on"
                defaultChecked={editType?.requiresAcknowledgment ?? false}
                label="Requiere acuse de recibo del trabajador"
              />
              {/* Dos campos y no uno: publicar una versión y acusar recibo son
                  hechos distintos del programa. Un tipo de difusión que
                  declarara su número en el campo de publicación acreditaría al
                  publicar, sin que nadie hubiera acusado nada. */}
              <input type="hidden" name="pdtpCatalogActivityIds" value={JSON.stringify(publishActivities)} />
              <input type="hidden" name="pdtpAcknowledgmentCatalogActivityIds" value={JSON.stringify(ackActivities)} />
              <PdtpActivityPicker multiple label="Actividades PDTP al publicar" options={catalogActivities} value={publishActivities} onChange={setPublishActivities} />
              <PdtpActivityPicker multiple label="Actividades PDTP por acuse de recibo" options={catalogActivities} value={ackActivities} onChange={setAckActivities} />
              <Checkbox
                id="type-active"
                name="isActive"
                value="on"
                defaultChecked={editType?.isActive ?? true}
                label="Tipo activo"
              />
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear tipo"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
