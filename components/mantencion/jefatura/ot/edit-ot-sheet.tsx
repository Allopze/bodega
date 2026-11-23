"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { editWorkOrderAction } from "@/app/(app)/mantencion/ot/[id]/actions"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import type { ActionType, Specialty } from "@/lib/mantencion/action-type"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import {
  buildEditPayload, hiddenFieldMessage, OtRequestFields, visibleFieldKeys, type FormValues,
} from "./ot-request-fields"

/** Lo guardado de la solicitud: con esto se precarga el formulario de «Editar solicitud». */
export interface OtRequestSnapshot {
  equipmentLabel: string
  /** Faena del equipo (la de imputación): no se cambia aquí y no se ofrece como faena de ejecución. */
  worksiteId: string
  worksiteName: string
  repair: boolean
  maintenance: boolean
  requestDate: string
  requesterName: string
  repairDescription: string | null
  observations: string | null
  actionType: ActionType | null
  specialties: Specialty[]
  executionWorksiteId: string | null
  /** Ítems de la solicitud (no los que se agregaron en taller), en su orden. */
  annexItems: string[]
  maintenanceItems: string[]
  laborHours: number | null
  workPerformed: string | null
  /** La OT ya pasó por la salida de taller: sólo entonces tiene horas hombre que corregir. */
  hasExit: boolean
}

function toFormValues(request: OtRequestSnapshot): FormValues {
  return {
    vehicleId: "",
    repair: request.repair,
    maintenance: request.maintenance,
    requestDate: request.requestDate,
    requesterName: request.requesterName,
    repairDescription: request.repairDescription ?? "",
    observations: request.observations ?? "",
    annexItems: request.annexItems,
    maintenanceItems: request.maintenanceItems,
    assignedToUserId: "",
    actionType: request.actionType ?? "",
    specialties: request.specialties,
    executionWorksiteId: request.executionWorksiteId ?? "",
  }
}

/**
 * «Editar solicitud»: el formulario de «Nueva orden» con lo guardado precargado, mientras la OT está «Por
 * asignar» o «Asignada» (`canEditRequest`; el servidor lo vuelve a comprobar). Envía la `version` que vio al
 * abrirse: si otra sesión cambió la OT, el error («cambió en otra sesión») queda en el formulario y lo escrito
 * no se pierde ni pisa en silencio lo de la otra sesión; se cierra y se vuelve a abrir para ver lo nuevo.
 * Es un envío imperativo (`useOperation`), no un `<form action>`: la acción recibe un objeto, no `FormData`.
 */
export function EditOtSheet({
  open, onOpenChange, workOrderId, folio, version, request, executionWorksites, actionTypeRequired,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrderId: string
  folio: string
  version: number
  request: OtRequestSnapshot
  /** Faenas elegibles como «Faena de ejecución»; la del equipo se descarta aquí. */
  executionWorksites: Array<{ id: string; name: string }>
  actionTypeRequired: boolean
}) {
  const router = useRouter()
  const operation = useOperation()
  const [values, setValues] = React.useState<FormValues>(() => toFormValues(request))
  // La versión del momento de abrir: tras un `router.refresh()` por un conflicto, la prop cambia y reenviar con
  // ella pisaría, sin que se vea, lo que la otra sesión guardó.
  const [expectedVersion] = React.useState(version)

  const executionOptions = executionWorksites
    .filter((worksite) => worksite.id !== request.worksiteId)
    .map((worksite) => ({ value: worksite.id, label: worksite.name }))
  const fieldError = (...keys: string[]) => keys.map((key) => operation.fieldError(key)).find(Boolean)
  const visibleKeys = visibleFieldKeys(values, { create: false, executionWorksite: executionOptions.length > 0, mechanic: false })
  const hasFieldErrors = Object.keys(operation.fieldErrors).length > 0
  const generalMessage = hasFieldErrors ? hiddenFieldMessage(operation.fieldErrors, visibleKeys) : operation.message || undefined

  function submit(event: React.FormEvent) {
    event.preventDefault()
    operation.run(
      () => editWorkOrderAction(buildEditPayload(values, { workOrderId, expectedVersion })),
      (result) => {
        toast.success(result.message ?? "Solicitud actualizada")
        onOpenChange(false)
        router.refresh()
      },
      (result) => {
        if (/otra sesi[oó]n/i.test(result.message ?? "")) router.refresh()
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!operation.pending) onOpenChange(next) }}>
      <SheetContent className="sm:max-w-xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <div>
              <SheetTitle>Editar la solicitud de {folio}</SheetTitle>
              <SheetDescription>
                Corrige lo que se pidió mientras la orden no entra a taller. El cambio queda en el historial.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {generalMessage && (
              <p role="alert" tabIndex={-1} data-form-alert className="text-sm text-[var(--color-danger-ink)]">{generalMessage}</p>
            )}
            <FieldGroup>
              <Field label="Equipo" htmlFor="ot-equipo-edicion" helper="El equipo no se cambia: para otro equipo, anula la orden y crea una nueva.">
                <Input id="ot-equipo-edicion" value={request.equipmentLabel} readOnly />
              </Field>
              <Field label="Faena de imputación" htmlFor="ot-faena-imputacion" helper="Es la faena del equipo y no se cambia aquí: el folio y los costos se imputan a ella.">
                <Input id="ot-faena-imputacion" value={request.worksiteName} readOnly />
              </Field>
              <OtRequestFields
                values={values}
                setValues={setValues}
                fieldError={fieldError}
                actionTypeRequired={actionTypeRequired}
                executionOptions={executionOptions}
              />
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={operation.pending}>Cancelar</Button>
            <SubmitButton label="Guardar cambios" loadingLabel="Guardando…" pending={operation.pending} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
