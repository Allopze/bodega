"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { unitName } from "@/lib/mantencion/format"
import type { MantUnit } from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { EquipmentStatusFields } from "./equipment-status-fields"
import type { EquipmentFormCatalogs, EquipmentFormValues } from "./equipment-form-types"

const NEW_WORKSITE = "__new__"
const SELECT = "h-11 w-full sm:h-9"

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

/**
 * Formulario del equipo: es el mismo para «Agregar equipo» y «Editar ficha». Los
 * campos están controlados porque unos dependen de otros (el tipo fija la unidad
 * y con ella las pautas que se ofrecen; «Nueva faena…» muestra su nombre; la baja
 * pide su motivo). El servidor vuelve a validar todo y devuelve los errores por
 * campo; si hay registros, la unidad y la lectura inicial quedan fijas.
 */
export function EquipmentForm({
  action,
  catalogs,
  initial,
  vehicleId,
  lockedUnit,
  cancelHref,
  onCancel,
  onSaved,
  submitLabel,
}: {
  action: FormAction
  catalogs: EquipmentFormCatalogs
  initial: EquipmentFormValues
  /** Sólo en la edición. */
  vehicleId?: string
  /** Unidad que ya no se puede cambiar porque el equipo tiene registros. */
  lockedUnit?: MantUnit
  cancelHref?: string
  onCancel?: () => void
  onSaved?: () => void
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionState)
  const [values, setValues] = React.useState(initial)
  const set = <K extends keyof EquipmentFormValues>(key: K, value: EquipmentFormValues[K]) => setValues((current) => ({ ...current, [key]: value }))
  const error = (field: string) => state.fieldErrors?.[field]?.[0]

  const type = catalogs.types.find((item) => item.id === values.equipmentTypeId)
  const schedules = React.useMemo(() => (type ? catalogs.schedules.filter((item) => item.unit === type.unit) : []), [type, catalogs.schedules])
  const readingLocked = lockedUnit !== undefined
  const today = todayInChile()

  // Una pauta elegida antes de cambiar el tipo a otra unidad ya no sirve: se suelta, no se envía a escondidas.
  React.useEffect(() => {
    if (values.scheduleId && type && !schedules.some((item) => item.id === values.scheduleId)) setValues((current) => ({ ...current, scheduleId: "" }))
  }, [type, schedules, values.scheduleId])

  const reportedRef = React.useRef<ActionState | null>(null)
  React.useEffect(() => {
    if (!state.ok || reportedRef.current === state) return
    reportedRef.current = state
    toast.success(state.message ?? "Cambios guardados.")
    onSaved?.()
  }, [state, onSaved])

  return (
    <form action={formAction} noValidate className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6">
      {vehicleId && <input type="hidden" name="vehicleId" value={vehicleId} />}
      {!state.ok && state.message && !state.fieldErrors && <Callout tone="danger" role="alert" className="mb-4">{state.message}</Callout>}
      <p className="mb-4 text-sub">Los campos con * son obligatorios. El equipo aparece en la app del mecánico en su próxima sincronización.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Código interno" required htmlFor="eq-code" error={error("code")}>
          <Input id="eq-code" name="code" className="font-mono" autoComplete="off" placeholder="Ej: KA-147" value={values.code} onChange={(e) => set("code", e.target.value)} error={!!error("code")} />
        </Field>
        <div>
          <Field label="Patente" required={!values.noPlate} htmlFor="eq-plate" error={error("plate")} helper={values.noPlate ? "Sin patente: la patente será igual al código." : "Formato ABCD-12 o AB-1234."}>
            <Input id="eq-plate" name="plate" className="font-mono" autoComplete="off" placeholder="ABCD-12" disabled={values.noPlate} value={values.noPlate ? "" : values.plate} onChange={(e) => set("plate", e.target.value)} error={!!error("plate")} />
          </Field>
          <div className="mt-2">
            <Checkbox id="eq-noPlate" label="Sin patente" checked={values.noPlate} onChange={(e) => set("noPlate", e.target.checked)} />
            {values.noPlate && <input type="hidden" name="noPlate" value="1" />}
          </div>
        </div>
        <Field
          label="Tipo de equipo" required htmlFor="eq-type" error={error("equipmentTypeId")}
          helper={type ? `Se mide en ${unitName(type.unit)}.${readingLocked ? " No se puede cambiar a otra unidad porque ya tiene registros." : ""}` : undefined}
        >
          <OptionSelect
            id="eq-type" name="equipmentTypeId" className={SELECT} placeholder="Elige el tipo…" value={values.equipmentTypeId} error={!!error("equipmentTypeId")}
            onValueChange={(v) => set("equipmentTypeId", v)}
            options={catalogs.types.map((item) => ({ value: item.id, label: `${item.name} · ${item.unit}`, textValue: item.name, disabled: readingLocked && item.unit !== lockedUnit }))}
          />
        </Field>
        <Field label="Marca" required htmlFor="eq-brand" error={error("brandId")} helper="Lista cerrada: las reglas por marca de las pautas dependen de ella.">
          <OptionSelect id="eq-brand" name="brandId" className={SELECT} placeholder="Elige la marca…" value={values.brandId} error={!!error("brandId")} onValueChange={(v) => set("brandId", v)} options={catalogs.brands.map((item) => ({ value: item.id, label: item.name }))} />
        </Field>
        <Field label="Modelo" htmlFor="eq-model" error={error("model")}>
          <Input id="eq-model" name="model" autoComplete="off" value={values.model} onChange={(e) => set("model", e.target.value)} error={!!error("model")} />
        </Field>
        <Field label="Año" htmlFor="eq-year" error={error("year")}>
          <Input id="eq-year" name="year" inputMode="numeric" maxLength={4} autoComplete="off" value={values.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} error={!!error("year")} />
        </Field>
        <div>
          <Field label="Faena" required htmlFor="eq-worksite" error={error("worksiteId")} helper={values.worksiteId === NEW_WORKSITE ? "Si ya existe con otro acento o mayúsculas, se usa la existente." : undefined}>
            <OptionSelect
              id="eq-worksite" name="worksiteId" className={SELECT} placeholder="Elige la faena…" value={values.worksiteId} error={!!error("worksiteId")} onValueChange={(v) => set("worksiteId", v)}
              options={[...catalogs.worksites.map((item) => ({ value: item.id, label: item.name })), { value: NEW_WORKSITE, label: "Nueva faena…" }]}
            />
          </Field>
          {values.worksiteId === NEW_WORKSITE && (
            <div className="mt-2">
              <Field label="Nombre de la faena nueva" htmlFor="eq-newWorksite">
                <Input id="eq-newWorksite" name="newWorksiteName" autoComplete="off" value={values.newWorksiteName} onChange={(e) => set("newWorksiteName", e.target.value)} error={!!error("worksiteId")} />
              </Field>
            </div>
          )}
        </div>
        <Field
          label="Pauta de mantención" htmlFor="eq-schedule" error={error("scheduleId")}
          helper={!type ? "Elige primero el tipo de equipo." : schedules.length ? `Solo aparecen pautas en ${unitName(type.unit)}.` : `No hay pautas en ${unitName(type.unit)}. Crea una en Pautas.`}
        >
          <OptionSelect
            id="eq-schedule" name="scheduleId" className={SELECT} emptyLabel="Sin pauta" disabled={!type} value={values.scheduleId} error={!!error("scheduleId")} onValueChange={(v) => set("scheduleId", v)}
            options={schedules.map((item) => ({ value: item.id, label: `${item.name} (${item.intervalCount} ${item.intervalCount === 1 ? "intervalo" : "intervalos"})`, textValue: item.name }))}
          />
        </Field>
        <Field label={`Lectura actual${type ? ` (${type.unit})` : ""}`} htmlFor="eq-reading" error={error("initialReading")} helper={readingLocked ? "Fija: el equipo ya tiene registros." : "Opcional. Sirve para calcular la próxima mantención antes del primer registro."}>
          <Input id="eq-reading" name="initialReading" inputMode="numeric" className="font-mono" readOnly={readingLocked} value={values.initialReading} onChange={(e) => set("initialReading", e.target.value)} error={!!error("initialReading")} />
        </Field>
        {!readingLocked && values.initialReading.trim() && (
          <Field label="Fecha de la lectura" htmlFor="eq-readingDate" error={error("initialReadingDate")} helper="Si la dejas vacía, se usa hoy.">
            <DatePicker id="eq-readingDate" name="initialReadingDate" max={today} value={values.initialReadingDate} onChange={(iso) => set("initialReadingDate", iso)} error={!!error("initialReadingDate")} />
          </Field>
        )}
      </div>
      {vehicleId && (
        <EquipmentStatusFields
          retired={values.retired}
          reason={values.retiredReason}
          error={error("retiredReason")}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <SubmitButton label={submitLabel} loadingLabel="Guardando…" />
        {onCancel
          ? <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
          : cancelHref && <Button asChild variant="secondary"><Link href={cancelHref}>Cancelar</Link></Button>}
      </div>
    </form>
  )
}
