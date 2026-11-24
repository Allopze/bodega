"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { unitName } from "@/lib/mantencion/format"
import type { MantUnit } from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"
import type { EquipmentFormCatalogs } from "./equipment-form-types"

const SELECT = "h-11 w-full sm:h-9"

export interface EquipmentPlanValues {
  scheduleId: string
  initialReading: string
  initialReadingDate: string
}

/**
 * La pauta y la lectura inicial del equipo: lo propio de Mantención. Las comparten el alta
 * («Nuevo equipo») y «Editar mantención» de la ficha (crítica 2026-11-15, paso 4b), para que
 * las dos ofrezcan lo mismo. Sólo se ofrecen pautas de la unidad del equipo; con registros, la
 * lectura queda fija. Son campos sueltos: el formulario que los usa decide la grilla.
 */
export function EquipmentPlanFields({
  unit,
  schedules,
  values,
  readingLocked,
  error,
  onChange,
}: {
  /** Unidad del equipo; `null` mientras no se elige el tipo (en el alta). */
  unit: MantUnit | null
  schedules: EquipmentFormCatalogs["schedules"]
  values: EquipmentPlanValues
  /** El equipo ya tiene registros: la lectura inicial no se puede cambiar. */
  readingLocked: boolean
  error: (field: string) => string | undefined
  onChange: (patch: Partial<EquipmentPlanValues>) => void
}) {
  const offered = unit ? schedules.filter((item) => item.unit === unit) : []
  const today = todayInChile()
  return (
    <>
      <Field
        label="Pauta de mantención" htmlFor="eq-schedule" error={error("scheduleId")}
        helper={!unit ? "Elige primero el tipo de equipo." : offered.length ? `Sólo aparecen pautas en ${unitName(unit)}.` : `No hay pautas en ${unitName(unit)}. Crea una en Pautas.`}
      >
        <OptionSelect
          id="eq-schedule" name="scheduleId" className={SELECT} emptyLabel="Sin pauta" disabled={!unit} value={values.scheduleId} error={!!error("scheduleId")} onValueChange={(v) => onChange({ scheduleId: v })}
          options={offered.map((item) => ({ value: item.id, label: `${item.name} (${item.intervalCount} ${item.intervalCount === 1 ? "intervalo" : "intervalos"})`, textValue: item.name }))}
        />
      </Field>
      <Field label={`Lectura inicial${unit ? ` (${unit})` : ""}`} htmlFor="eq-reading" error={error("initialReading")} helper={readingLocked ? "Fija: el equipo ya tiene registros." : "Opcional. Con la lectura inicial y una preventiva (firmada o declarada) se calcula la próxima mantención."}>
        <Input id="eq-reading" name="initialReading" inputMode="numeric" className="font-mono" readOnly={readingLocked} value={values.initialReading} onChange={(e) => onChange({ initialReading: e.target.value })} error={!!error("initialReading")} />
      </Field>
      {!readingLocked && values.initialReading.trim() && (
        <Field label="Fecha de la lectura" htmlFor="eq-readingDate" error={error("initialReadingDate")} helper="Si la dejas vacía, se usa hoy.">
          <DatePicker id="eq-readingDate" name="initialReadingDate" max={today} value={values.initialReadingDate} onChange={(iso) => onChange({ initialReadingDate: iso })} error={!!error("initialReadingDate")} />
        </Field>
      )}
    </>
  )
}
