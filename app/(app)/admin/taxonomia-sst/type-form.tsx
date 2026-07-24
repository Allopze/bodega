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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { SST_DOCUMENT_CATEGORY_SLUGS, SST_DOCUMENT_CONFIDENTIALITIES } from "@/lib/validation/prevention"
import { saveDocumentTypeAction } from "./actions"
import type { TypeRow } from "./taxonomy-list"

interface TypeFormProps {
  open: boolean
  onClose: () => void
  editType?: TypeRow | null
  categorySlug: string
}

const CATEGORY_LABEL: Record<string, string> = {
  gestion_preventiva: "Gestión preventiva",
  legal_normativa: "Legal y normativa",
  capacitacion: "Capacitación e inducciones",
  epp: "EPP",
  incidentes: "Incidentes y accidentes",
  comite: "Comité Paritario",
  emergencias: "Emergencias",
  equipos_vehiculos: "Equipos, vehículos y maquinaria",
  fiscalizacion: "Fiscalización y auditorías",
  salud_ocupacional: "Salud ocupacional",
}

const CONFIDENTIALITY_LABEL: Record<string, string> = {
  publico_interno: "Público interno",
  restringido: "Restringido",
  sensible: "Sensible",
}

export function TypeForm({ open, onClose, editType, categorySlug }: TypeFormProps) {
  const isEdit = !!editType
  const initialCategory = editType?.categorySlug ?? categorySlug
  const [catSlug, setCatSlug] = React.useState(initialCategory)
  const [defaultConf, setDefaultConf] = React.useState(editType?.defaultConfidentiality ?? "publico_interno")

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
                    {SST_DOCUMENT_CATEGORY_SLUGS.map((slug) => (
                      <SelectItem key={slug} value={slug}>{CATEGORY_LABEL[slug] ?? slug}</SelectItem>
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
              <Field label="Vigencia por defecto (meses)" htmlFor="type-validity" error={state.fieldErrors?.defaultValidityMonths?.[0]} helper="Opcional — meses hasta vencimiento si aplica.">
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
              <Checkbox
                id="type-ack"
                name="requiresAcknowledgment"
                value="on"
                defaultChecked={editType?.requiresAcknowledgment ?? false}
                label="Requiere acuse de recibo del trabajador"
              />
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
