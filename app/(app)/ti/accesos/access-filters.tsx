"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const ALL = "_all"

interface Option { id: string; name: string }

/**
 * Filtros de la matriz de accesos.
 *
 * Antes eran un `<form method="get">` con botón "Aplicar": recargaba la página
 * completa y no se parecía a ningún otro filtro del módulo. Acá se aplican al
 * instante con `router.replace(..., { scroll: false })`, el patrón de
 * preservación de scroll de la plataforma, igual que `activos/asset-filters`.
 *
 * `/ti/accesos` está en `ROUTES_WITH_OWN_SEARCH`, así que el TopBar oculta su
 * buscador y esta caja de búsqueda es la única de la pantalla.
 */
export function AccessFilters({
  current,
  worksites,
  systems,
}: {
  current: Record<string, string | string[] | undefined>
  worksites: Option[]
  systems: Option[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  const search = typeof current.q === "string" ? current.q : ""
  const worksite = typeof current.faena === "string" ? current.faena : ""
  const system = typeof current.sistema === "string" ? current.sistema : ""

  const [draft, setDraft] = React.useState(search)
  // Sincroniza durante el render y no en un efecto, igual que
  // `components/ui/filter-search-input.tsx`: con el efecto, la respuesta RSC
  // de una navegación anterior sobreescribía lo que el usuario seguía
  // escribiendo y le saltaba el caret al final.
  const [lastSynced, setLastSynced] = React.useState(search)
  if (lastSynced !== search) {
    setLastSynced(search)
    setDraft(search)
  }

  // Lee la URL viva en cada llamada en vez de los valores del render: el
  // `router.replace` de un filtro y la respuesta RSC que actualiza estas props
  // no son simultáneos, así que un temporizador de búsqueda que venciera en
  // medio reconstruía la query con los valores viejos y borraba la faena que
  // el usuario acababa de elegir.
  const apply = React.useCallback((next: Record<string, string>) => {
    const params = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router])

  // La búsqueda se debouncea: cada tecla no debe disparar una navegación.
  React.useEffect(() => {
    if (draft === search) return
    const timer = setTimeout(() => apply({ q: draft }), 350)
    return () => clearTimeout(timer)
  }, [draft, search, apply])

  const chips: ActiveFilterChip[] = []
  if (worksite) {
    chips.push({
      key: "faena",
      label: "Faena",
      value: worksite,
      displayValue: worksites.find((w) => w.id === worksite)?.name ?? worksite,
    })
  }
  if (system) {
    chips.push({
      key: "sistema",
      label: "Sistema",
      value: system,
      displayValue: systems.find((s) => s.id === system)?.name ?? system,
    })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => apply({ [key]: "" })}
      onClearAll={() => router.replace(pathname, { scroll: false })}
      hasActiveFilters={Boolean(search)}
    >
      <Input
        aria-label="Buscar trabajador"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Buscar trabajador…"
        className="h-11 w-full text-xs sm:h-8 sm:w-56"
      />
      <Select value={worksite || ALL} onValueChange={(v) => apply({ faena: v === ALL ? "" : v })}>
        <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label="Filtrar accesos por faena">
          <SelectValue placeholder="Todas las faenas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las faenas</SelectItem>
          {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={system || ALL} onValueChange={(v) => apply({ sistema: v === ALL ? "" : v })}>
        <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label="Filtrar accesos por sistema">
          <SelectValue placeholder="Todos los sistemas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los sistemas</SelectItem>
          {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </FilterToolbar>
  )
}
