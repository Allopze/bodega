"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { unitName } from "@/lib/mantencion/format"
import type { ActionState } from "@/lib/validation/operations"
import { EquipmentPlanFields } from "./equipment-plan-fields"
import type { EquipmentFormCatalogs, EquipmentFormValues } from "./equipment-form-types"

const SELECT = "h-11 w-full sm:h-9"

/** ¿Hay al menos un error por campo? Un `{}` no cuenta: el mensaje general tiene que verse. */
const hasFieldErrors = (state: ActionState) => Object.keys(state.fieldErrors ?? {}).length > 0

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

/**
 * Formulario de «Nuevo equipo». Los campos están controlados porque unos dependen de otros (el
 * tipo fija la unidad y con ella las pautas que se ofrecen). El servidor vuelve a validar todo y
 * devuelve los errores por campo.
 *
 * Un equipo que ya existe no se edita aquí (crítica 2026-11-15, paso 4b): su identidad se edita
 * en «Editar vehículo» (el padrón, con estas mismas reglas) y su pauta, lectura inicial y baja en
 * «Editar mantención» (`EquipmentPlanForm`, que comparte los campos de la pauta).
 */
export function EquipmentForm({
  action,
  catalogs,
  initial,
  cancelHref,
  submitLabel,
}: {
  action: FormAction
  catalogs: EquipmentFormCatalogs
  initial: EquipmentFormValues
  cancelHref?: string
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionState)
  const [values, setValues] = React.useState(initial)
  const set = <K extends keyof EquipmentFormValues>(key: K, value: EquipmentFormValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const error = (field: string) => state.fieldErrors?.[field]?.[0]

  const type = catalogs.types.find((item) => item.id === values.equipmentTypeId)
  const schedules = React.useMemo(() => (type ? catalogs.schedules.filter((item) => item.unit === type.unit) : []), [type, catalogs.schedules])

  // Una pauta elegida antes de cambiar el tipo a otra unidad ya no sirve: se suelta, no se envía a escondidas.
  React.useEffect(() => {
    if (values.scheduleId && type && !schedules.some((item) => item.id === values.scheduleId)) setValues((current) => ({ ...current, scheduleId: "" }))
  }, [type, schedules, values.scheduleId])

  const reportedRef = React.useRef<ActionState | null>(null)
  React.useEffect(() => {
    if (!state.ok || reportedRef.current === state) return
    reportedRef.current = state
    toast.success(state.message ?? "Cambios guardados.")
  }, [state])

  return (
    <form action={formAction} noValidate className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
      {!state.ok && state.message && !hasFieldErrors(state) && <Callout tone="danger" role="alert" className="mb-4">{state.message}</Callout>}
      <p className="mb-4 text-sub">Los campos con * son obligatorios.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Código interno" required htmlFor="eq-code" error={error("code")}>
          <Input id="eq-code" name="code" className="font-mono" autoComplete="off" placeholder="Ej: KA-147" value={values.code} onChange={(e) => set("code", e.target.value)} error={!!error("code")} />
        </Field>
        <div>
          <Field label="Patente" required={!values.noPlate} htmlFor="eq-plate" error={error("plate")} helper={values.noPlate ? "Sin patente: la patente será igual al código." : "Formato ABCD-12 o AB-1234."}>
            <Input id="eq-plate" name="plate" className="font-mono" autoComplete="off" disabled={values.noPlate} value={values.noPlate ? "" : values.plate} onChange={(e) => set("plate", e.target.value)} error={!!error("plate")} />
          </Field>
          <div className="mt-2">
            <Checkbox id="eq-noPlate" label="Sin patente" checked={values.noPlate} onChange={(e) => set("noPlate", e.target.checked)} />
            {values.noPlate && <input type="hidden" name="noPlate" value="1" />}
          </div>
        </div>
        <Field
          label="Tipo de equipo" required htmlFor="eq-type" error={error("equipmentTypeId")}
          helper={type ? `Se mide en ${unitName(type.unit)}.` : undefined}
        >
          <OptionSelect
            id="eq-type" name="equipmentTypeId" className={SELECT} placeholder="Elige el tipo…" value={values.equipmentTypeId} error={!!error("equipmentTypeId")}
            onValueChange={(v) => set("equipmentTypeId", v)}
            options={catalogs.types.map((item) => ({ value: item.id, label: `${item.name} · ${item.unit}`, textValue: item.name }))}
          />
        </Field>
        <Field label="Marca" required htmlFor="eq-brand" error={error("brandId")} helper="Lista cerrada: las pautas dependen de la marca.">
          <OptionSelect id="eq-brand" name="brandId" className={SELECT} placeholder="Elige la marca…" value={values.brandId} error={!!error("brandId")} onValueChange={(v) => set("brandId", v)} options={catalogs.brands.map((item) => ({ value: item.id, label: item.name }))} />
        </Field>
        <Field label="Modelo" htmlFor="eq-model" error={error("model")}>
          <Input id="eq-model" name="model" autoComplete="off" value={values.model} onChange={(e) => set("model", e.target.value)} error={!!error("model")} />
        </Field>
        <Field label="Año" htmlFor="eq-year" error={error("year")}>
          <Input id="eq-year" name="year" inputMode="numeric" maxLength={4} autoComplete="off" value={values.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} error={!!error("year")} />
        </Field>
        {/* Sólo faenas que ya existen: las nuevas se crean en Administración › Faenas, para no duplicarlas (auditoría 2026-11-13, M12). */}
        <Field label="Faena" required htmlFor="eq-worksite" error={error("worksiteId")}>
          <OptionSelect
            id="eq-worksite" name="worksiteId" className={SELECT} placeholder="Elige la faena…" value={values.worksiteId} error={!!error("worksiteId")} onValueChange={(v) => set("worksiteId", v)}
            options={catalogs.worksites.map((item) => ({ value: item.id, label: item.name }))}
          />
        </Field>
        <EquipmentPlanFields
          unit={type?.unit ?? null}
          schedules={catalogs.schedules}
          values={values}
          readingLocked={false}
          error={error}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton label={submitLabel} loadingLabel="Guardando…" />
        {cancelHref && <Button asChild variant="secondary"><Link href={cancelHref}>Cancelar</Link></Button>}
      </div>
    </form>
  )
}
