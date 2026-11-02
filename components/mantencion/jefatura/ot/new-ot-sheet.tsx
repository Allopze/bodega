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
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/ui/submit-button"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import type { WorkOrderEquipmentOption } from "@/lib/services/mantencion/work-orders/query"
import { OtItemListEditor } from "./ot-item-list-editor"

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
  /** Rótulo del botón que abre el formulario (por defecto «Nueva OT»). */
  triggerLabel?: string
  triggerVariant?: "primary" | "secondary"
}

export interface FormValues {
  vehicleId: string
  repair: boolean
  maintenance: boolean
  requestDate: string
  requesterName: string
  repairDescription: string
  observations: string
  annexItems: string[]
  maintenanceItems: string[]
  assignedToUserId: string
}

function initialValues(props: Pick<NewOtSheetProps, "today" | "defaultRequesterName">): FormValues {
  return {
    vehicleId: "", repair: true, maintenance: false, requestDate: props.today, requesterName: props.defaultRequesterName,
    repairDescription: "", observations: "", annexItems: [], maintenanceItems: [], assignedToUserId: "",
  }
}

/** Líneas sin texto fuera: la lista guarda también las que se están escribiendo. */
function cleanItems(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

/** Lo que viaja en el campo `payload`: el `createWorkOrderSchema`. */
export function buildCreatePayload(values: FormValues, clientRequestId: string) {
  return {
    clientRequestId,
    vehicleId: values.vehicleId,
    repair: values.repair,
    maintenance: values.maintenance,
    requestDate: values.requestDate,
    requesterName: values.requesterName.trim(),
    repairDescription: values.repair ? values.repairDescription.trim() || null : null,
    observations: values.observations.trim() || null,
    annexItems: cleanItems(values.annexItems),
    maintenanceItems: cleanItems(values.maintenanceItems),
    assignedToUserId: values.assignedToUserId || null,
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
      toast.success(result.message ?? (folio ? `OT ${folio} creada` : "OT creada"))
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
  const payload = JSON.stringify(buildCreatePayload(values, clientRequestId))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant={props.triggerVariant ?? "primary"}><Plus size={14} className="mr-1.5" aria-hidden /> {props.triggerLabel ?? "Nueva OT"}</Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form ref={formRef} action={formAction} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <div>
              <SheetTitle>Nueva orden de trabajo</SheetTitle>
              <SheetDescription>
                Pide una reparación o una mantención para un equipo. Le avisamos a Mantención y la OT queda en tu nombre.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p role="alert" tabIndex={-1} data-form-alert className="text-sm text-[var(--color-danger-ink)]">{state.message}</p>
            )}
            <input type="hidden" name="payload" value={payload} />

            <FieldGroup>
              <Field
                label="Equipo"
                htmlFor="ot-equipo"
                required
                error={fieldError("vehicleId")}
                helper={chosen ? `Faena: ${chosen.worksiteName}. La OT queda en la faena del equipo.` : undefined}
              >
                <Combobox
                  id="ot-equipo"
                  options={equipmentOptions}
                  value={values.vehicleId}
                  onChange={(value) => {
                    // El mecánico elegido es de la faena del equipo anterior: con otro equipo se vuelve a elegir.
                    if (props.worksiteMechanics) setValues((current) => ({ ...current, vehicleId: value, assignedToUserId: "" }))
                    else set("vehicleId", value)
                  }}
                  placeholder="Busca por código o patente"
                />
              </Field>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Tipo de trabajo <span aria-hidden className="text-[var(--color-danger)]">*</span></legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Checkbox id="ot-reparacion" label="Reparación" checked={values.repair} onChange={(event) => set("repair", event.target.checked)} />
                  <Checkbox id="ot-mantencion" label="Mantención" checked={values.maintenance} onChange={(event) => set("maintenance", event.target.checked)} />
                </div>
                {fieldError("repair", "maintenance") && <p role="alert" className="text-xs text-[var(--color-danger)]">{fieldError("repair", "maintenance")}</p>}
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha de la OT" htmlFor="ot-fecha" required error={fieldError("requestDate")}>
                  <DatePicker id="ot-fecha" value={values.requestDate} onChange={(iso) => set("requestDate", iso)} ariaLabel="Fecha de la OT" />
                </Field>
                <Field label="Solicitante" htmlFor="ot-solicitante" required error={fieldError("requesterName")}>
                  <Input id="ot-solicitante" value={values.requesterName} maxLength={120} onChange={(event) => set("requesterName", event.target.value)} />
                </Field>
              </div>

              {values.repair && (
                <Field label="Reparación" htmlFor="ot-reparacion-desc" required error={fieldError("repairDescription")} helper="Qué hay que reparar, con el detalle que tengas.">
                  <Textarea
                    id="ot-reparacion-desc"
                    value={values.repairDescription}
                    maxLength={2000}
                    rows={3}
                    placeholder="Ej. Pierde aceite por el cárter y hace ruido al frenar."
                    onChange={(event) => set("repairDescription", event.target.value)}
                  />
                </Field>
              )}

              {values.repair && (
                <OtItemListEditor
                  idPrefix="ot-anexo"
                  legend="Trabajos anexos (reparación)"
                  helper="Trabajos que se piden junto con la reparación. Opcional."
                  placeholder="Ej. Cambiar pastillas de freno"
                  items={values.annexItems}
                  onChange={(next) => set("annexItems", next)}
                  error={fieldError("annexItems")}
                />
              )}

              {values.maintenance && (
                <OtItemListEditor
                  idPrefix="ot-mant"
                  legend="Mantenciones solicitadas o asignadas en taller"
                  helper="Cada mantención que se pide hacer. El mecánico marca SÍ o NO al terminar."
                  placeholder="Ej. Cambio de aceite y filtros"
                  items={values.maintenanceItems}
                  onChange={(next) => set("maintenanceItems", next)}
                  error={fieldError("maintenanceItems")}
                />
              )}

              <Field label="Observaciones" htmlFor="ot-observaciones" error={fieldError("observations")}>
                <Textarea id="ot-observaciones" value={values.observations} maxLength={2000} rows={2} onChange={(event) => set("observations", event.target.value)} />
              </Field>

              {props.mechanics && (
                <Field label="Mecánico (opcional)" htmlFor="ot-mecanico" error={fieldError("assignedToUserId")} helper="Si lo dejas vacío, la OT queda por asignar hasta que la asignes.">
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
                      : `${chosen.worksiteName} no tiene mecánico: la OT queda por asignar y la jefatura de mantención la asigna.`}
                  </p>
                )
              )}
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Crear OT" loadingLabel="Creando…" disabled={!values.vehicleId || !clientRequestId} />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
