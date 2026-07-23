"use client"

import * as React from "react"
import { DatePicker } from "@/components/ui/date-picker"
import { cn } from "@/lib/utils"

export interface DateRangePickerProps {
  fromValue?: string
  toValue?: string
  onFromChange?: (iso: string) => void
  onToChange?: (iso: string) => void
  fromName?: string
  toName?: string
  fromId?: string
  toId?: string
  fromPlaceholder?: string
  toPlaceholder?: string
  disabled?: boolean
  className?: string
  pickerClassName?: string
}

export function DateRangePicker({
  fromValue = "",
  toValue = "",
  onFromChange,
  onToChange,
  fromName,
  toName,
  fromId,
  toId,
  fromPlaceholder = "Desde",
  toPlaceholder = "Hasta",
  disabled,
  className,
  pickerClassName,
}: DateRangePickerProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <div className="flex flex-col gap-1.5">
        {fromId && (
          <label htmlFor={fromId} className="text-xs font-medium text-[var(--color-text-subtle)]">
            Desde
          </label>
        )}
        <DatePicker
          id={fromId}
          name={fromName}
          value={fromValue}
          onChange={onFromChange}
          max={toValue || undefined}
          placeholder={fromPlaceholder}
          disabled={disabled}
          className={pickerClassName}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {toId && (
          <label htmlFor={toId} className="text-xs font-medium text-[var(--color-text-subtle)]">
            Hasta
          </label>
        )}
        <DatePicker
          id={toId}
          name={toName}
          value={toValue}
          onChange={onToChange}
          min={fromValue || undefined}
          placeholder={toPlaceholder}
          disabled={disabled}
          className={pickerClassName}
        />
      </div>
    </div>
  )
}
