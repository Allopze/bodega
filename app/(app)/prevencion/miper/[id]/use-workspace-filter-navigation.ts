"use client"

import { useCallback } from "react"
import { usePathname } from "next/navigation"
import { navigateWorkspace } from "./workspace-nav"

/**
 * Cambia filtros de la URL sin ida al servidor (`router.replace` costaba un
 * fetch RSC por cambio o por tecla): arma la URL aquí y la aplica con
 * `navigateWorkspace(..., "replace")`. Parte de la URL **vigente**
 * (`window.location.search`), no de la del último render: dos cambios seguidos
 * —la búsqueda con su espera de 300 ms y un chip— no se pisan (A2, fila 15).
 *
 * `keys` acota los filtros que maneja: `setFilter(s)` sólo acepta esas claves y
 * `clearFilters()` borra sólo esas, nunca la vista (`tab`, `fila`, `actividad`…)
 * ni los filtros de otra pestaña.
 */
export function useWorkspaceFilterNavigation<K extends string>(keys: readonly K[]) {
  const pathname = usePathname()
  const setFilters = useCallback((patch: Partial<Record<K, string | null>>) => {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch) as Array<[K, string | null | undefined]>) {
      if (value === undefined) continue
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    navigateWorkspace(query ? `${pathname}?${query}` : pathname, "replace")
  }, [pathname])
  const setFilter = useCallback((key: K, value: string | null) => setFilters({ [key]: value } as Partial<Record<K, string | null>>), [setFilters])
  const clearFilters = useCallback(
    () => setFilters(Object.fromEntries(keys.map((key) => [key, null])) as Partial<Record<K, string | null>>),
    [keys, setFilters],
  )
  return { setFilter, setFilters, clearFilters }
}
