"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { OptionSelect } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

/**
 * Filtro de faena de la lista de traslados: aplica al cambiar (`router.replace` sin mover el scroll). Una
 * faena cuenta como origen o destino. El período va en la cabecera (`PeriodControl`) y el texto lo filtra
 * la barra superior.
 */
export function TransferFilters({ worksiteId, worksites }: { worksiteId: string; worksites: Array<{ id: string; name: string }> }) {
  useWorksiteFilterPresence()
  const { setFilter, isPending } = useUrlFilters()
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending || undefined}>
      <OptionSelect
        aria-label="Filtrar por faena" className="h-11 w-full text-xs sm:h-8 sm:w-56" emptyLabel="Todas las faenas"
        options={worksites.map((site) => ({ value: site.id, label: site.name }))}
        value={worksiteId} onValueChange={(value) => setFilter("faena", value)}
      />
    </div>
  )
}
