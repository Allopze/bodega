"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

/**
 * Selector de período del resumen.
 *
 * El período va en la URL porque identifica *qué* se está mirando: es
 * compartible y sobrevive a un refresco. (Los filtros de interfaz que no
 * cambian el contenido no deben ir a la URL — ver la nota de `router.refresh`
 * en el módulo de Prevención.)
 */
export function PeriodPicker({ period }: { period: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const months = recentPeriods(24)

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--color-text-muted)]">Período</span>
      <select
        value={period}
        disabled={isPending}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString())
          params.set("periodo", event.target.value)
          startTransition(() => router.push(`${pathname}?${params.toString()}`))
        }}
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"
      >
        {months.map((value) => (
          <option key={value} value={value}>{formatOption(value)}</option>
        ))}
      </select>
    </label>
  )
}

/** Últimos N períodos hasta el mes actual, del más reciente al más antiguo. */
function recentPeriods(count: number): string[] {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

function formatOption(period: string): string {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("es-CL", {
    month: "long", year: "numeric", timeZone: "UTC",
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}
