"use client"

import * as React from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"

interface DateTimeParts {
  date: string
  time: string
}

function splitDateTime(value: string | undefined): DateTimeParts {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return { date: match?.[1] ?? "", time: match?.[2] ?? "00:00" }
}

export interface DateTimePickerProps {
  /** Local ISO value without timezone, e.g. `2026-09-03T14:30`. */
  value?: string
  /** Default local ISO value for form/server-action usage. */
  defaultValue?: string
  onChange?: (value: string) => void
  name?: string
  id?: string
  disabled?: boolean
  error?: boolean
  /**
   * Cotas locales `YYYY-MM-DDTHH:mm`. Acotan el calendario por su parte de
   * fecha —el control de hora es un `<input type="time">` que no sabe del día—,
   * así que la hora exacta la sigue validando el servidor.
   */
  min?: string
  max?: string
  "aria-describedby"?: string
}

/**
 * DatePicker with an explicit time control for workflows that store a local
 * datetime. The date keeps the platform calendar UX while the time remains
 * keyboard-friendly and the server receives the same datetime-local shape.
 */
export function DateTimePicker({
  value,
  defaultValue,
  onChange,
  name,
  id,
  disabled,
  error,
  min,
  max,
  "aria-describedby": ariaDescribedBy,
}: DateTimePickerProps) {
  const initial = splitDateTime(defaultValue)
  const [internalDate, setInternalDate] = React.useState(initial.date)
  const [internalTime, setInternalTime] = React.useState(initial.time)
  const controlled = value !== undefined
  const current = controlled ? splitDateTime(value) : { date: internalDate, time: internalTime }

  function update(nextDate: string, nextTime: string) {
    const next = nextDate ? `${nextDate}T${nextTime || "00:00"}` : ""
    if (!controlled) {
      setInternalDate(nextDate)
      setInternalTime(nextTime || "00:00")
    }
    onChange?.(next)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
      {name && <input type="hidden" name={name} value={current.date ? `${current.date}T${current.time}` : ""} />}
      <DatePicker
        id={id ? `${id}-date` : undefined}
        value={current.date}
        onChange={(nextDate) => update(nextDate, current.time)}
        disabled={disabled}
        error={error}
        min={min?.slice(0, 10) || undefined}
        max={max?.slice(0, 10) || undefined}
        ariaLabel="Fecha"
        aria-describedby={ariaDescribedBy}
      />
      <Input
        id={id ? `${id}-time` : undefined}
        type="time"
        value={current.time}
        onChange={(event) => update(current.date, event.target.value)}
        disabled={disabled}
        aria-label="Hora"
        aria-describedby={ariaDescribedBy}
        aria-invalid={error || undefined}
      />
    </div>
  )
}
