"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { addDaysToPlainDate } from "@/lib/utils"

/**
 * Selector del día de la vista «Día»: ‹ anterior · fecha · siguiente ›. Cada gesto aplica de inmediato
 * (`router.replace` + `scroll: false`): el día es estado de la vista, no una navegación. No deja pasar de
 * `max` (hoy): no hay telemetría que mirar en el futuro.
 */
export function DayControl({ day, max, defaultDay }: { day: string; max: string; defaultDay: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = React.useTransition()

  function go(next: string) {
    if (!next || next > max) return
    const params = new URLSearchParams(searchParams.toString())
    // El día por defecto (ayer) no viaja en la URL: así «hoy mismo» sigue siendo «ayer» mañana.
    if (next === defaultDay) params.delete("dia")
    else params.set("dia", next)
    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  return (
    <div role="group" aria-label="Día" className="flex items-center gap-1">
      <Button type="button" variant="secondary" size="icon" aria-label="Día anterior" onClick={() => go(addDaysToPlainDate(day, -1))}>
        <CaretLeft size={14} weight="bold" aria-hidden="true" />
      </Button>
      <DatePicker value={day} onChange={go} max={max} ariaLabel="Elegir el día" className="min-w-40" />
      <Button type="button" variant="secondary" size="icon" aria-label="Día siguiente" disabled={day >= max} onClick={() => go(addDaysToPlainDate(day, 1))}>
        <CaretRight size={14} weight="bold" aria-hidden="true" />
      </Button>
    </div>
  )
}
