"use client"

import * as React from "react"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

export interface WorksiteOption {
  id?: string
  value?: string
  name?: string
  label?: string
}

export interface WorksiteSelectProps {
  worksites: WorksiteOption[]
  value: string
  onChange: (value: string) => void
  includeAll?: boolean
  allValue?: string
  allLabel?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  name?: string
  className?: string
  triggerClassName?: string
  "aria-label"?: string
}

export function WorksiteSelect({
  worksites,
  value,
  onChange,
  includeAll = true,
  allValue = "_all",
  allLabel = "Todas las faenas",
  placeholder = "Todas las faenas",
  disabled = false,
  id,
  name,
  triggerClassName,
  "aria-label": ariaLabel = "Filtrar por faena",
}: WorksiteSelectProps) {
  const normalizedValue = !value || value === "" ? (includeAll ? allValue : "") : value

  const normalizedOptions = React.useMemo(() => {
    return worksites.map((ws) => ({
      val: ws.id ?? ws.value ?? "",
      lbl: ws.name ?? ws.label ?? "",
    }))
  }, [worksites])

  function handleValueChange(newValue: string) {
    if (newValue === allValue) {
      onChange("")
    } else {
      onChange(newValue)
    }
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <Select
        value={normalizedValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger id={id} className={triggerClassName} aria-label={ariaLabel}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {includeAll && (
            <SelectItem value={allValue}>{allLabel}</SelectItem>
          )}
          {normalizedOptions.map((opt) => (
            <SelectItem key={opt.val} value={opt.val}>
              {opt.lbl}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
