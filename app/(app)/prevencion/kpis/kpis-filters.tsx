"use client"

import { useRouter, usePathname } from "next/navigation"
import { Field } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

interface Props {
  year: number
  worksiteId?: string
  worksites: { id: string; name: string }[]
}

const YEARS = Array.from({ length: 5 }, (_, i) => 2026 - i)

export function KpisFilters({ year, worksiteId, worksites }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  function navigate(next: { year?: number; faena?: string }) {
    const params = new URLSearchParams()
    params.set("anio", String(next.year ?? year))
    const nextFaena = next.faena ?? worksiteId
    if (nextFaena) params.set("faena", nextFaena)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:max-w-md">
      <Field label="Año" htmlFor="kpi-year">
        <Select value={String(year)} onValueChange={(v) => navigate({ year: Number(v) })}>
          <SelectTrigger id="kpi-year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Faena" htmlFor="kpi-faena">
        <Select value={worksiteId ?? ""} onValueChange={(v) => navigate({ faena: v })}>
          <SelectTrigger id="kpi-faena">
            <SelectValue placeholder="Selecciona faena" />
          </SelectTrigger>
          <SelectContent>
            {worksites.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}
