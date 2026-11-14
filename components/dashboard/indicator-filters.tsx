"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { PeriodControl } from "@/components/ui/period-control"
import { WorksiteSelect } from "@/components/ui/worksite-select"

/**
 * Los dos filtros primarios de una pantalla de Indicadores (A2): período y
 * faena. Ambos viajan en la URL (`desde`/`hasta` y `faena`) y se aplican al
 * cambiar, con `router.replace` + `scroll: false` (patrón de filtros de
 * AGENTS.md). El selector de faena sólo aparece si quien mira ve más de una.
 */
export function IndicatorFilters({
  from,
  to,
  defaultRange,
  worksites,
  worksiteId,
}: {
  from: string
  to: string
  defaultRange: { from: string; to: string; label: string }
  worksites: ReadonlyArray<{ id: string; name: string }>
  /** Faena elegida; `null` = todas las visibles. */
  worksiteId: string | null
}) {
  const showWorksitePicker = worksites.length > 1
  useWorksiteFilterPresence(showWorksitePicker)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {showWorksitePicker && (
        <WorksiteSelect
          worksites={worksites as Array<{ id: string; name: string }>}
          value={worksiteId ?? ""}
          includeAll
          allLabel="Todas las faenas"
          disabled={pending}
          aria-label="Faena de los indicadores"
          triggerClassName="h-11 sm:h-9 w-[13rem] text-[13px]"
          onChange={(value) => {
            const params = new URLSearchParams(searchParams.toString())
            if (value) params.set("faena", value)
            else params.delete("faena")
            const query = params.toString()
            startTransition(() => {
              router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
            })
          }}
        />
      )}
      <PeriodControl mode="range" from={from} to={to} defaultRange={defaultRange} />
    </div>
  )
}
