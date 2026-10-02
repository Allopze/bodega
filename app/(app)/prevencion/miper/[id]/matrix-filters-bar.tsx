"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { activeFilterCount, type GridFilters } from "@/lib/prevention/miper/grid-view"
import { matrixFilterChips, matrixFilterPatch } from "@/lib/prevention/miper/matrix-filters"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import { navigateWorkspace } from "./workspace-nav"

/**
 * Cambia los filtros de la URL sin ida al servidor (`router.replace` costaba un
 * fetch RSC por cambio o por tecla): arma la URL aquí y la aplica con
 * `navigateWorkspace(..., "replace")`.
 */
export function useMatrixFilterNavigation() {
  const pathname = usePathname()
  const params = useSearchParams()
  const setFilters = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    navigateWorkspace(query ? `${pathname}?${query}` : pathname, "replace")
  }, [pathname, params])
  const setFilter = useCallback((key: string, value: string | null) => setFilters({ [key]: value }), [setFilters])
  return { setFilters, setFilter }
}

/**
 * Barra de la matriz (spec §5.1, regla A2): búsqueda propia y «Contraer todo»
 * a la vista; el resto, en el cajón «Filtros (N)» de `FilterToolbar`, con chips.
 */
export function MatrixFiltersBar({ filters: parsed, riskFactors, hasBaseline, collapsedAll, onToggleAll }: {
  filters: GridFilters; riskFactors: ReadonlyArray<{ id: string; name: string }>; hasBaseline: boolean; collapsedAll: boolean; onToggleAll: () => void
}) {
  // Un `?factor=` que no es de esta matriz se trata como «Todos»: ni chip ni selección.
  const filters = parsed.factorId !== "all" && !riskFactors.some((factor) => factor.id === parsed.factorId) ? { ...parsed, factorId: "all" } : parsed
  const { setFilters, setFilter } = useMatrixFilterNavigation()
  const [search, setSearch] = useState(filters.search)
  useEffect(() => { setSearch(filters.search) }, [filters.search])
  useEffect(() => {
    if (search === filters.search) return
    const timer = setTimeout(() => setFilter("buscar", search.trim() || null), 300)
    return () => clearTimeout(timer)
  }, [search, filters.search, setFilter])
  const apply = (next: GridFilters) => setFilters(matrixFilterPatch(next))
  const chips = matrixFilterChips(filters, riskFactors)
  return (
    <FilterToolbar
      activeChips={chips}
      activeCount={activeFilterCount(filters) - (filters.search ? 1 : 0)}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => { setSearch(""); setFilters(matrixFilterPatch({ ...filters, search: "", classifications: [], controlled: "all", factorId: "all", onlyObserved: false, onlyModified: false, onlyIncomplete: false, onlyComplete: false })) }}
      actions={<Button variant="secondary" size="sm" onClick={onToggleAll}>{collapsedAll ? "Expandir todo" : "Contraer todo"}</Button>}
      overflowFilters={(
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Clasificación</legend>
            {[...RISK_CLASSIFICATIONS].reverse().map((cls) => (
              <Checkbox key={cls} label={CLASSIFICATION_LABEL[cls]} checked={filters.classifications.includes(cls)}
                onChange={(event) => apply({ ...filters, classifications: event.target.checked ? [...filters.classifications, cls] : filters.classifications.filter((item) => item !== cls) })} />
            ))}
          </fieldset>
          <Field label="Estado del riesgo">
            <OptionSelect aria-label="Estado del riesgo" emptyLabel="Todos" value={filters.onlyIncomplete ? "pendientes" : filters.onlyComplete ? "completos" : ""}
              options={[{ value: "pendientes", label: "Con pendientes" }, { value: "completos", label: "Completos" }]}
              onValueChange={(value) => apply({ ...filters, onlyIncomplete: value === "pendientes", onlyComplete: value === "completos" })} />
          </Field>
          <Field label="¿Está controlado?">
            <OptionSelect aria-label="¿Está controlado?" emptyLabel="Todos" value={filters.controlled === "all" ? "" : filters.controlled}
              options={[{ value: "yes", label: "Sí" }, { value: "partial", label: "Parcialmente" }, { value: "no", label: "No" }]}
              onValueChange={(value) => apply({ ...filters, controlled: (value || "all") as GridFilters["controlled"] })} />
          </Field>
          <Field label="Factor de riesgo">
            <OptionSelect aria-label="Factor de riesgo" emptyLabel="Todos" value={filters.factorId === "all" ? "" : filters.factorId}
              options={riskFactors.map((factor) => ({ value: factor.id, label: factor.name }))}
              onValueChange={(value) => apply({ ...filters, factorId: value || "all" })} />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Marcas</legend>
            <Checkbox label="Observados" checked={filters.onlyObserved} onChange={(event) => apply({ ...filters, onlyObserved: event.target.checked })} />
            {hasBaseline && <Checkbox label="Modificados" checked={filters.onlyModified} onChange={(event) => apply({ ...filters, onlyModified: event.target.checked })} />}
          </fieldset>
        </div>
      )}
    >
      <Field label="Buscar en la matriz" htmlFor="miper-matrix-search" className="w-full sm:w-80">
        <Input id="miper-matrix-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Actividad, tarea, peligro, medida…" />
      </Field>
    </FilterToolbar>
  )
}
