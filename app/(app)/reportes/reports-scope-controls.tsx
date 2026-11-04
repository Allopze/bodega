"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { DEFAULT_REPORT_PERIOD, REPORT_PERIODS, type ReportPeriod } from "./reportes-period"

/** URL de `/reportes` con el período y la faena elegidos; lo que vale el valor por omisión no viaja en la URL. */
export function reportsScopeHref(period: ReportPeriod, worksiteId: string | undefined): string {
  const params = new URLSearchParams()
  if (period !== DEFAULT_REPORT_PERIOD) params.set("periodo", period)
  if (worksiteId) params.set("faena", worksiteId)
  const query = params.toString()
  return query ? `/reportes?${query}` : "/reportes"
}

/**
 * Los dos filtros de Reportes: período y faena. Mismo patrón que el alcance del tablero: el período son
 * enlaces (navegan sin una línea de cliente) y la faena es un `Select` que reemplaza la entrada del
 * historial y no mueve el scroll (AGENTS.md, «Navigation and scroll preservation pattern»).
 */
export function ReportsScopeControls({
  period,
  worksiteId,
  worksites,
}: {
  period: ReportPeriod
  worksiteId: string | undefined
  worksites: ReadonlyArray<{ id: string; name: string }>
}) {
  useWorksiteFilterPresence(worksites.length > 1)
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {worksites.length > 1 && (
        <WorksiteSelect
          worksites={worksites as Array<{ id: string; name: string }>}
          value={worksiteId ?? ""}
          includeAll
          allValue="_all"
          allLabel="Todas las faenas"
          disabled={pending}
          aria-label="Faena del reporte"
          triggerClassName="h-11 sm:h-9 w-[13rem] text-[13px]"
          onChange={(value) => {
            startTransition(() => {
              router.replace(reportsScopeHref(period, value || undefined), { scroll: false })
            })
          }}
        />
      )}
      <SegmentedControl
        variant="segmented"
        ariaLabel="Período del reporte"
        items={REPORT_PERIODS.map((entry) => ({
          key: entry.value,
          label: entry.label,
          href: reportsScopeHref(entry.value, worksiteId),
          active: period === entry.value,
        }))}
      />
    </div>
  )
}
