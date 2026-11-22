"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "@phosphor-icons/react"
import { createWorkOrderAction } from "@/app/(app)/mantencion/ot/actions"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import type { WorkOrderEquipmentOption } from "@/lib/services/mantencion/work-orders/query"
import {
  buildCreatePayload, checksForActionType, hiddenFieldMessage, OtRequestFields, visibleFieldKeys, type FormValues,
} from "./ot-request-fields"

// El formulario compartido vive en `ot-request-fields.tsx`; se reexporta por quien ya lo importaba desde aquí.
export { buildCreatePayload, checksForActionType }
export type { FormValues }

export interface NewOtSheetProps {
  equipment: WorkOrderEquipmentOption[]
  /** Sólo con `mant:ot:manage`: asignar al crear a cualquier mecánico (opcional). `null` oculta el selector. */
  mechanics: Array<{ id: string; name: string; worksiteNames: string[] }> | null
  /**
   * Sin `mant:ot:manage` (administrador de contrato): los mecánicos de sus
   * faenas. La OT queda asignada al de la faena del equipo; si hay varios, se
   * elige. El servidor aplica la misma regla.
   */
  worksiteMechanics?: Array<{ id: string; name: string; worksiteId: string }> | null
  /** Hoy en Chile (`todayInChile()` del servidor): fecha por defecto de la OT. */
  today: string
  /** Nombre de quien crea: SOLICITANTE por defecto, editable. */
  defaultRequesterName: string
  /** Rótulo del botón que abre el formulario (por defecto «Nueva orden»). */
  triggerLabel?: string
  triggerVariant?: "primary" | "secondary"
  /**
   * `ops.mantencion.ot_action_type_required` encendido: el tipo de acción es obligatorio. Sólo marca el
   * campo; quien lo exige es el servidor. Sin esta prop (la ficha del equipo) el campo se ofrece como opcional.
   */
  actionTypeRequired?: boolean
  /** Faenas elegibles como «Faena de ejecución». Sin ellas, el campo no se ofrece. */
  worksites?: Array<{ id: string; name: string }>
  /** Equipo que viene elegido al abrir (la ficha del equipo lo precarga); sin él, se busca uno. */
  defaultVehicleId?: string
}

function initialValues(props: Pick<NewOtSheetProps, "today" | "defaultRequesterName" | "defaultVehicleId">): FormValues {
  return {
    vehicleId: props.defaultVehicleId ?? "", repair: true, maintenance: false, requestDate: props.today, requesterName: props.defaultRequesterName,
    repairDescription: "", observations: "", annexItems: [], maintenanceItems: [], assignedToUserId: "",
    actionType: "", specialties: [], executionWorksiteId: "",
  }
}

/**
 * CTA del encabezado. El botón se construye aquí, en el cliente, y no lo recibe
 * la página: ver la nota de `SheetTrigger` en `@/components/ui/sheet`.
 */
export function NewWorkOrderCta(props: NewOtSheetProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<FormValues>(() => initialValues(props))
  // La clave de idempotencia nace al abrir: un reintento tras un fallo de red no duplica la OT.
  const [clientRequestId, setClientRequestId] = React.useState("")
  const formRef = React.useRef<HTMLFormElement>(null)

  const [state, formAction] = useActionState<ActionState & { data?: Record<string, unknown> }, FormData>(async (prev, formData) => {
    const result = await createWorkOrderAction(prev, formData)
    if (result.ok) {
      const id = String(result.data?.id ?? "")
      const folio = String(result.data?.folio ?? "")
      toast.success(folio ? `Orden ${folio} creada` : "Orden creada")
      setOpen(false)
      if (id) router.push(`/mantencion/ot/${id}`)
    }
    // Los errores se muestran en el formulario, no además en un toast.
    return result
  }, INITIAL_STATE)

  function onOpenChange(next: boolean) {
    if (next) {
      setValues(initialValues(props))
      setClientRequestId(crypto.randomUUID())
    }
    setOpen(next)
  }

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const errors = state.ok ? undefined : state.fieldErrors
  const fieldError = (...keys: string[]) => keys.map((key) => errors?.[key]?.[0]).find(Boolean)

  const equipmentOptions = props.equipment.map((item) => ({
    value: item.id,
    label: item.plate && item.plate !== item.code ? `${item.code} · ${item.plate}` : item.code,
    hint: `${item.typeName} · ${item.worksiteName}`,
  }))
  const chosen = props.equipment.find((item) => item.id === values.vehicleId)
  const mechanicOptions = (props.mechanics ?? []).map((mechanic) => ({
    value: mechanic.id,
    label: mechanic.worksiteNames.length ? `${mechanic.name} · ${mechanic.worksiteNames.join(", ")}` : mechanic.name,
  }))
  const faenaMechanics = props.worksiteMechanics && chosen
    ? props.worksiteMechanics.filter((mechanic) => mechanic.worksiteId === chosen.worksiteId)
    : []
  const executionOptions = (props.worksites ?? [])
    .filter((worksite) => worksite.id !== chosen?.worksiteId)
    .map((worksite) => ({ value: worksite.id, label: worksite.name }))
  const payload = JSON.stringify(buildCreatePayload(values, clientRequestId))
  // Un error de un campo que no se ve (p. ej. una lista de ítems oculta) no puede quedar mudo: va como mensaje general.
  const hasFieldErrors = !!errors && Object.keys(errors).length > 0
  const visibleKeys = visibleFieldKeys(values, {
    create: true,
    executionWorksite: executionOptions.length > 0,
    mechanic: !!props.mechanics || (!!props.worksiteMechanics && faenaMechanics.length > 1),
  })
  const generalMessage = state.ok ? undefined : hasFieldErrors ? hiddenFieldMessage(errors, visibleKeys) : state.message || undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant={props.triggerVariant ?? "primary"}><Plus size={14} className="mr-1.5" aria-hidden /> {props.triggerLabel ?? "Nueva orden"}</Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form ref={formRef} action={formAction} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <div>
              <SheetTitle>Nueva orden de trabajo</SheetTitle>
              <SheetDescription>
                Pide una reparación o una mantención para un equipo. Le avisamos a Mantención y la orden queda en tu nombre.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {generalMessage && (
              <p role="alert" tabIndex={-1} data-form-alert className="text-sm text-[var(--color-danger-ink)]">{generalMessage}</p>
            )}
            <input type="hidden" name="payload" value={payload} />

            <FieldGroup>
              <Field
                label="Equipo"
                htmlFor="ot-equipo"
                required
                error={fieldError("vehicleId")}
              >
                <Combobox
                  id="ot-equipo"
                  options={equipmentOptions}
                  value={values.vehicleId}
                  onChange={(value) => {
                    // El mecánico elegido es de la faena del equipo anterior: con otro equipo se vuelve a elegir.
                    // La faena de ejecución no puede ser la del equipo: con otro equipo se vuelve a elegir.
                    setValues((current) => ({ ...current, vehicleId: value, executionWorksiteId: "", ...(props.worksiteMechanics ? { assignedToUserId: "" } : {}) }))
                  }}
                  placeholder="Busca por código o patente"
                />
              </Field>

              {chosen && (
                <Field label="Faena de imputación" htmlFor="ot-faena-imputacion" helper="Es la faena del equipo y no se cambia aquí: el folio y los costos se imputan a ella.">
                  <Input id="ot-faena-imputacion" value={chosen.worksiteName} readOnly />
                </Field>
              )}

              <OtRequestFields
                values={values}
                setValues={setValues}
                fieldError={fieldError}
                actionTypeRequired={props.actionTypeRequired}
                executionOptions={executionOptions}
              />

              {props.mechanics && (
                <Field label="Mecánico (opcional)" htmlFor="ot-mecanico" error={fieldError("assignedToUserId")} helper="Si lo dejas vacío, la orden queda por asignar hasta que la asignes.">
                  <OptionSelect
                    id="ot-mecanico"
                    emptyLabel="Dejar por asignar"
                    options={mechanicOptions}
                    value={values.assignedToUserId}
                    onValueChange={(value) => set("assignedToUserId", value)}
                  />
                </Field>
              )}

              {props.worksiteMechanics && chosen && (
                faenaMechanics.length > 1 ? (
                  <Field label="Mecánico" htmlFor="ot-mecanico" required error={fieldError("assignedToUserId")} helper={`Mecánicos de ${chosen.worksiteName}. La jefatura de mantención puede reasignarla.`}>
                    <OptionSelect
                      id="ot-mecanico"
                      emptyLabel="Elige un mecánico"
                      options={faenaMechanics.map((mechanic) => ({ value: mechanic.id, label: mechanic.name }))}
                      value={values.assignedToUserId}
                      onValueChange={(value) => set("assignedToUserId", value)}
                    />
                  </Field>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]" data-testid="ot-mecanico-faena">
                    {faenaMechanics.length === 1
                      ? <>Se asigna a <strong className="font-semibold text-[var(--color-text)]">{faenaMechanics[0]!.name}</strong>, mecánico de {chosen.worksiteName}. La jefatura de mantención puede reasignarla.</>
                      : `${chosen.worksiteName} no tiene mecánico: la orden queda por asignar y la jefatura de mantención la asigna.`}
                  </p>
                )
              )}
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Crear orden" loadingLabel="Creando…" disabled={!values.vehicleId || !clientRequestId} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
