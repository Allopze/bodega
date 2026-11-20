"use client"

import * as React from "react"
import { CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { OTHER_SHIFT_LABEL, SHIFT_PRESETS, shiftPresetLabel } from "@/lib/fleet/shifts/constants"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import type { ShiftRow } from "@/lib/services/fleet-shifts-views"
import { createShiftAction, updateShiftAction } from "./actions"
import { hourLabel } from "./format"

export interface ShiftFormVehicle { id: string; code: string; hasVisionLink: boolean }
export interface ShiftFormOperator { id: string; name: string; isMachineOperator: boolean }

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }))
const TURNO_OPTIONS = [
  ...SHIFT_PRESETS.map((preset) => ({ value: preset.label, label: preset.label })),
  { value: OTHER_SHIFT_LABEL, label: OTHER_SHIFT_LABEL },
]
const MAX_NOTES = 500
const OPEN_KEY = "flota-turnos:formulario-abierto"

/**
 * Preferencia de plegado del formulario (excepción A3: estación de captura repetitiva). Abierto de fábrica;
 * quien lo pliega lo encuentra plegado la próxima vez. El almacenamiento puede estar bloqueado: no es requisito.
 */
export function useShiftFormOpenPreference(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = React.useState(true)
  React.useEffect(() => {
    try { if (localStorage.getItem(OPEN_KEY) === "0") setOpenState(false) } catch { /* almacenamiento bloqueado */ }
  }, [])
  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next)
    try { localStorage.setItem(OPEN_KEY, next ? "1" : "0") } catch { /* almacenamiento bloqueado */ }
  }, [])
  return [open, setOpen]
}

function turnoOf(start: number | null, end: number | null): string {
  if (start === null || end === null) return ""
  return shiftPresetLabel(start, end) ?? OTHER_SHIFT_LABEL
}

/**
 * Formulario de turno en línea y plegable. Sirve para registrar y para editar (`editing`): al editar se monta
 * con `key` del turno y se inicializa con sus valores. Elegir un turno predefinido llena Inicio y Fin; cambiar
 * una hora a mano vuelve a «Otro horario» salvo que el par calce con un predefinido. No pide confirmación al
 * guardar: el error, si lo hay, queda sobre el botón.
 */
export function ShiftForm({
  day, vehicles, operators, editing, open, onOpenChange, onEditDone,
}: {
  day: string
  vehicles: ShiftFormVehicle[]
  operators: ShiftFormOperator[]
  editing: ShiftRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEditDone: () => void
}) {
  const [vehicleId, setVehicleId] = React.useState(editing?.vehicleId ?? "")
  const [startHour, setStartHour] = React.useState<number | null>(editing?.startHour ?? null)
  const [endHour, setEndHour] = React.useState<number | null>(editing?.endHour ?? null)
  const [turno, setTurno] = React.useState(() => turnoOf(editing?.startHour ?? null, editing?.endHour ?? null))
  const [operatorId, setOperatorId] = React.useState(editing?.operatorWorkerId ?? "")
  const [notes, setNotes] = React.useState(editing?.notes ?? "")
  const [touched, setTouched] = React.useState(false)
  const { pending, message, run } = useOperation()

  const vehicleOptions = React.useMemo<ComboboxOption[]>(() => {
    const options = vehicles.map((vehicle) => (
      vehicle.hasVisionLink ? { value: vehicle.id, label: vehicle.code } : { value: vehicle.id, label: vehicle.code, hint: "sin VisionLink" }
    ))
    // Editar un turno de un equipo que ya no está entre los activos de la faena ese día: se conserva su valor.
    if (editing && !options.some((option) => option.value === editing.vehicleId)) options.push({ value: editing.vehicleId, label: editing.vehicleCode })
    return options
  }, [vehicles, editing])
  const operatorOptions = React.useMemo<ComboboxOption[]>(() => {
    const options = operators.map((operator) => (
      operator.isMachineOperator ? { value: operator.id, label: operator.name, hint: "Operador de maquinaria" } : { value: operator.id, label: operator.name }
    ))
    if (editing && !options.some((option) => option.value === editing.operatorWorkerId)) options.push({ value: editing.operatorWorkerId, label: editing.operatorName })
    return options
  }, [operators, editing])

  function pickTurno(next: string) {
    setTurno(next)
    const preset = SHIFT_PRESETS.find((candidate) => candidate.label === next)
    if (!preset) return
    setStartHour(preset.startHour)
    setEndHour(preset.endHour)
  }

  function pickHour(which: "start" | "end", value: string) {
    const hour = value === "" ? null : Number(value)
    const nextStart = which === "start" ? hour : startHour
    const nextEnd = which === "end" ? hour : endHour
    if (which === "start") setStartHour(hour)
    else setEndHour(hour)
    setTurno(turnoOf(nextStart, nextEnd) || (turno === OTHER_SHIFT_LABEL ? OTHER_SHIFT_LABEL : ""))
  }

  const sameHours = startHour !== null && startHour === endHour
  const missingVehicle = touched && !vehicleId
  const missingStart = touched && startHour === null
  const missingEnd = touched && endHour === null
  const missingOperator = touched && !operatorId

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!vehicleId || startHour === null || endHour === null || !operatorId || sameHours) return
    const input = {
      vehicleId,
      shiftDate: editing?.shiftDate ?? day,
      startHour,
      endHour,
      operatorWorkerId: operatorId,
      notes: notes.trim(),
    }
    run(
      () => (editing ? updateShiftAction(editing.id, input) : createShiftAction(input)),
      () => {
        if (editing) {
          toast.success("Turno actualizado.")
          onEditDone()
          return
        }
        toast.success("Turno registrado.")
        // Captura repetida: se conservan equipo y turno; operador y observación son de cada turno.
        setOperatorId("")
        setNotes("")
        setTouched(false)
      },
    )
  }

  return (
    <section
      aria-label={editing ? "Editar turno" : "Registrar turno"}
      className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="shift-form-body"
        onClick={() => onOpenChange(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left"
      >
        <span className="text-sm font-semibold text-[var(--color-text)]">{editing ? "Editar turno" : "Registrar turno"}</span>
        <CaretDown size={14} weight="bold" aria-hidden="true" className={cn("text-[var(--color-text-subtle)] transition-transform", open && "rotate-180")} />
      </button>
      <form id="shift-form-body" hidden={!open} onSubmit={submit} noValidate className="space-y-4 border-t border-[var(--color-border)] p-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 xl:grid-cols-6">
          <Field label="Equipo" htmlFor="shift-vehicle" required error={missingVehicle ? "Elige el equipo." : undefined} className="col-span-2 xl:col-span-2">
            <Combobox id="shift-vehicle" options={vehicleOptions} value={vehicleId} onChange={setVehicleId} placeholder="Buscar equipo..." />
          </Field>
          <Field label="Turno" htmlFor="shift-preset" className="col-span-2 xl:col-span-2">
            <OptionSelect id="shift-preset" options={TURNO_OPTIONS} value={turno} onValueChange={pickTurno} placeholder="Elige un turno" />
          </Field>
          <Field label="Inicio" htmlFor="shift-start" required error={missingStart ? "Elige la hora." : undefined}>
            <OptionSelect id="shift-start" options={HOUR_OPTIONS} value={startHour === null ? "" : String(startHour)} onValueChange={(value) => pickHour("start", value)} placeholder="Hora" />
          </Field>
          <Field
            label="Fin" htmlFor="shift-end" required
            error={missingEnd ? "Elige la hora." : touched && sameHours ? "El inicio y el fin no pueden ser iguales." : undefined}
          >
            <OptionSelect id="shift-end" options={HOUR_OPTIONS} value={endHour === null ? "" : String(endHour)} onValueChange={(value) => pickHour("end", value)} placeholder="Hora" />
          </Field>
          <Field label="Operador" htmlFor="shift-operator" required error={missingOperator ? "Elige el operador." : undefined} className="col-span-2 xl:col-span-3">
            <Combobox id="shift-operator" options={operatorOptions} value={operatorId} onChange={setOperatorId} placeholder="Buscar operador..." />
          </Field>
          <Field label="Observación" htmlFor="shift-notes" className="col-span-2 xl:col-span-3">
            <Input id="shift-notes" type="text" maxLength={MAX_NOTES} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">El turno de noche se registra con la fecha en que comienza.</p>
        {message && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {editing && <Button type="button" variant="secondary" onClick={onEditDone} disabled={pending}>Cancelar</Button>}
          <Button type="submit" loading={pending}>{editing ? "Guardar cambios" : "Guardar turno"}</Button>
        </div>
      </form>
    </section>
  )
}
