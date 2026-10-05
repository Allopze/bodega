"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { cn } from "@/lib/utils"
import { WARRANTY_BANDS, type WarrantyView } from "./warranty-windows"

const ALL = "_all"

/**
 * Bandas de garantía (pastillas con contador) + faena. La dimensión "ventana"
 * tiene una sola representación interactiva (A5): las pastillas; no hay además
 * un Select. Son enlaces con `aria-current="true"` —no `"page"`, que declara
 * una página distinta— y `scroll={false}` para no perder la posición.
 */
export function WarrantyFilters({
  view, faena, counts, worksites,
}: {
  view: WarrantyView
  faena: string
  counts: Record<string, number>
  worksites: { id: string; name: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  function href(nextView: string, nextFaena: string) {
    const params = new URLSearchParams()
    if (nextView) params.set("ventana", nextView)
    if (nextFaena) params.set("faena", nextFaena)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  const pills = [{ value: "" as WarrantyView, label: "Todas" }, ...WARRANTY_BANDS]
  // Una vista heredada (`expiring_60`…) no tiene pastilla: ninguna queda activa.
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por vigencia de garantía">
        {pills.map((w) => {
          const active = view === w.value
          return (
            <Link
              key={w.value || "todas"}
              href={href(w.value, faena)}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors sm:min-h-8",
                active
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              {w.label}
              <span className="font-mono tabular-nums">{counts[w.value] ?? 0}</span>
            </Link>
          )
        })}
      </div>
      <FilterToolbar
        className="mb-0"
        onClearAll={() => router.replace(href(view, ""), { scroll: false })}
        hasActiveFilters={Boolean(faena)}
      >
        <Select value={faena || ALL} onValueChange={(v) => router.replace(href(view, v === ALL ? "" : v), { scroll: false })}>
          <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label="Filtrar por faena">
            <SelectValue placeholder="Todas las faenas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las faenas</SelectItem>
            {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>
    </div>
  )
}
