"use client"

import { useActionState } from "react"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { savePdtpCatalogActivityAction } from "./actions"

export interface CatalogActivityRow {
  id: string
  code: string
  status: "draft" | "active" | "retired"
  currentRevision: number
  title: string
  description: string
  executionGuidance: string
  retiredReason: string | null
  updatedAt: string
  revisions: Array<{
    revision: number
    title: string
    description: string
    executionGuidance: string
    changeNote: string
    createdAt: string
  }>
}

export function ActivityForm({
  open,
  onClose,
  activity,
}: {
  open: boolean
  onClose: () => void
  activity?: CatalogActivityRow | null
}) {
  const isRevision = Boolean(activity)
  const [, formAction] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await savePdtpCatalogActivityAction(previous, formData)
    if (result.ok) {
      toast.success(result.message ?? "Actividad guardada")
      onClose()
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          {activity && <input type="hidden" name="id" value={activity.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isRevision ? "Crear nueva revisión" : "Nueva actividad"}</SheetTitle>
              <SheetDescription>
                {isRevision
                  ? "Los programas existentes conservarán la revisión que ya adoptaron."
                  : "La definición se crea como borrador y debe publicarse antes de usarla."}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            <FieldGroup className="gap-4">
              <Field label="Código estable" htmlFor="activity-code" required={!isRevision} helper="Inmutable. Formato PDT-AREA-ACCION.">
                <Input id="activity-code" name="code" defaultValue={activity?.code ?? "PDT-"} disabled={isRevision} required={!isRevision} />
              </Field>
              <Field label="Título" htmlFor="activity-title" required helper="Etiqueta imperativa y distintiva, máximo 80 caracteres.">
                <Input id="activity-title" name="title" defaultValue={activity?.title ?? ""} minLength={3} maxLength={80} required />
              </Field>
              <Field label="Descripción de la actividad" htmlFor="activity-description" required>
                <Textarea id="activity-description" name="description" defaultValue={activity?.description ?? ""} required rows={5} />
              </Field>
              <Field label="Guía de ejecución" htmlFor="activity-guidance" required>
                <Textarea id="activity-guidance" name="executionGuidance" defaultValue={activity?.executionGuidance ?? ""} required rows={7} />
              </Field>
              {isRevision && (
                <Field label="Motivo del cambio" htmlFor="activity-change-note" required helper="Quedará registrado en el historial de revisiones.">
                  <Textarea id="activity-change-note" name="changeNote" minLength={10} required rows={3} />
                </Field>
              )}
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isRevision ? "Crear revisión" : "Crear borrador"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
