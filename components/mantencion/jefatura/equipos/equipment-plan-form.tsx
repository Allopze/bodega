"use client"

import * as React from "react"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { SubmitButton } from "@/components/ui/submit-button"
import type { MantUnit } from "@/lib/mantencion/types"
import { toast } from "@/lib/toast"
import type { ActionState } from "@/lib/validation/operations"
import { EquipmentPlanFields, type EquipmentPlanValues } from "./equipment-plan-fields"
import { EquipmentStatusFields } from "./equipment-status-fields"
import type { EquipmentFormCatalogs } from "./equipment-form-types"

/** ¿Hay al menos un error por campo? Un `{}` no cuenta: el mensaje general tiene que verse. */
const hasFieldErrors = (state: ActionState) => Object.keys(state.fieldErrors ?? {}).length > 0

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

export interface EquipmentPlanFormValues extends EquipmentPlanValues {
  retired: boolean
  retiredReason: string
}

/**
 * «Editar mantención» de la pestaña Mantención (crítica 2026-11-15, paso 4b): la pauta, la
 * lectura inicial y el estado (activo o dado de baja). La identidad del equipo —código, patente,
 * tipo, marca, modelo, año y faena— se edita en un solo lugar, «Editar vehículo», con las mismas
 * reglas de Mantención; antes este formulario la repetía y dos personas podían dejarla distinta.
 */
export function EquipmentPlanForm({
  action,
  vehicleId,
  unit,
  schedules,
  initial,
  readingLocked,
  extra,
  expectedUpdatedAt,
  onCancel,
  onSaved,
}: {
  action: FormAction
  vehicleId: string
  unit: MantUnit
  schedules: EquipmentFormCatalogs["schedules"]
  initial: EquipmentPlanFormValues
  readingLocked: boolean
  /** Una sección más dentro del mismo `<form>` (la preventiva declarada), con los errores por campo y la pauta elegida. */
  extra?: (context: { error: (field: string) => string | undefined; scheduleId: string }) => React.ReactNode
  /** `updated_at` del plan al abrir el formulario; el servidor no guarda si cambió después. */
  expectedUpdatedAt?: string
  onCancel: () => void
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionState)
  const [values, setValues] = React.useState(initial)
  const patch = (next: Partial<EquipmentPlanFormValues>) => setValues((current) => ({ ...current, ...next }))
  const error = (field: string) => state.fieldErrors?.[field]?.[0]

  const reportedRef = React.useRef<ActionState | null>(null)
  React.useEffect(() => {
    if (!state.ok || reportedRef.current === state) return
    reportedRef.current = state
    toast.success(state.message ?? "Cambios guardados.")
    onSaved()
  }, [state, onSaved])

  return (
    <form action={formAction} noValidate aria-label="Editar mantención" className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      {expectedUpdatedAt ? <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} /> : null}
      {!state.ok && state.message && !hasFieldErrors(state) && <Callout tone="danger" role="alert" className="mb-4">{state.message}</Callout>}
      <p className="mb-4 text-sub">
        La pauta, la lectura inicial y el estado del equipo en Mantención. El código, la patente, el tipo, la marca y la faena se cambian en «Editar vehículo».
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <EquipmentPlanFields unit={unit} schedules={schedules} values={values} readingLocked={readingLocked} error={error} onChange={patch} />
      </div>
      <EquipmentStatusFields retired={values.retired} reason={values.retiredReason} error={error("retiredReason")} onChange={patch} />
      {extra?.({ error, scheduleId: values.scheduleId })}
      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton label="Guardar cambios" loadingLabel="Guardando…" />
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  )
}
