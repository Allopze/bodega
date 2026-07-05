"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface PdtpYearPickerProps {
  current: number
  options: number[]
}

export function PdtpYearPicker({ current, options }: PdtpYearPickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set("anio", value)
    const qs = next.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return (
    <Select value={String(current)} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger
        className="h-8 w-[110px] text-sm"
        aria-label="Año del programa"
        data-testid="pdtp-year-picker"
      >
        <SelectValue placeholder={String(current)} />
      </SelectTrigger>
      <SelectContent>
        {options.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
