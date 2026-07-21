"use client"

import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface FilterOption {
  value: string
  label: string
}

export function FilterSelect({
  name,
  defaultValue = "",
  options,
  placeholder = "Todas",
  ariaLabel,
  className,
}: {
  name: string
  defaultValue?: string
  options: FilterOption[]
  placeholder?: string
  ariaLabel?: string
  className?: string
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label={ariaLabel} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{placeholder}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name={name} value={value} />
    </>
  )
}
