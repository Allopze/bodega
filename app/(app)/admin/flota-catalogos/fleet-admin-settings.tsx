"use client"

import { useActionState } from "react"
import { Card } from "@/components/ui/card"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/admin/submit-button"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { saveFleetAdminSettingsAction } from "./actions"

interface FleetAdminSettingsProps {
  warningDays: number
  defaultVehicleStatus: string
}

const STATUS_OPTIONS = [
  { value: "operativo", label: "Operativo" },
  { value: "mantencion", label: "En mantención" },
  { value: "fuera_servicio", label: "Fuera de servicio" },
] as const

export function FleetAdminSettings({ warningDays, defaultVehicleStatus }: FleetAdminSettingsProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveFleetAdminSettingsAction(prev, formData)
      if (result.ok) toast.success(result.message ?? "Parámetros guardados")
      else if (result.message) toast.error(result.message)
      return result
    },
    INITIAL_STATE,
  )

  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-1 text-sm font-semibold">Parámetros administrativos</h2>
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        Define los valores predeterminados y las reglas para los recordatorios de documentos.
      </p>
      {state.message && !state.ok && (
        <div className="mb-3 rounded-[var(--radius)] border border-[var(--color-danger)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-danger)]">
          {state.message}
        </div>
      )}
      <form action={formAction} className="space-y-4">
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Días de aviso antes de vencimiento"
              htmlFor="warningDays"
              helper="Predeterminado: 30. Rango: 1 a 365 días."
              error={state.fieldErrors?.warningDays?.[0]}
            >
              <Input
                id="warningDays"
                name="warningDays"
                type="number"
                min={1}
                max={365}
                step={1}
                defaultValue={String(warningDays)}
                error={!!state.fieldErrors?.warningDays}
              />
            </Field>
            <Field
              label="Estado predeterminado de vehículo nuevo"
              htmlFor="defaultVehicleStatus"
              helper="Aplicado al crear un vehículo desde el módulo administrativo."
              error={state.fieldErrors?.defaultVehicleStatus?.[0]}
            >
              <select
                id="defaultVehicleStatus"
                name="defaultVehicleStatus"
                defaultValue={defaultVehicleStatus}
                className="h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </FieldGroup>
        <div className="flex justify-end pt-2">
          <SubmitButton label="Guardar parámetros de flota" loadingLabel="Guardando..." />
        </div>
      </form>
    </Card>
  )
}
