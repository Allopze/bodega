"use client"

import { OptionSelect } from "@/components/ui/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { DEFAULT_PANEL_PERIOD, PANEL_PERIOD_LABEL, PANEL_PERIODS, type PanelPeriod } from "@/lib/services/mantencion/panel-filters"

/**
 * Período y faena del panel (§10). Ambos viven en la URL y cambian con
 * `router.replace` sin mover el scroll (los filtros son estado de la vista, no
 * navegación). El período por omisión no se escribe en la URL para que el
 * enlace limpio siga siendo el del panel.
 */
export function PanelFiltersBar({
  period,
  worksiteId,
  worksites,
}: {
  period: PanelPeriod
  worksiteId: string
  worksites: Array<{ id: string; name: string }>
}) {
  const { setFilter } = useUrlFilters()
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl
        ariaLabel="Período"
        items={PANEL_PERIODS.map((value) => ({
          key: value,
          label: PANEL_PERIOD_LABEL[value],
          active: period === value,
          onClick: () => setFilter("periodo", value === DEFAULT_PANEL_PERIOD ? null : value),
        }))}
      />
      {worksites.length > 1 && (
        <OptionSelect
          aria-label="Faena"
          className="h-11 w-full text-xs sm:h-8 sm:w-52"
          emptyLabel="Todas las faenas"
          options={worksites.map((item) => ({ value: item.id, label: item.name }))}
          value={worksiteId}
          onValueChange={(value) => setFilter("faena", value)}
        />
      )}
    </div>
  )
}
