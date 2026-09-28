"use client"

import * as React from "react"

export interface ShellHeaderState {
  title?:       string
  description?: string
  breadcrumb?: React.ReactNode
  actions?:    React.ReactNode
}

interface HeaderContextValue {
  header:    ShellHeaderState
  setHeader: React.Dispatch<React.SetStateAction<ShellHeaderState>>
}

interface SearchContextValue {
  searchQuery:    string
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
}

// Dos contextos separados a proposito: un componente puede consumir solo
// searchQuery (useSafeShellHeader) mientras otro en el mismo arbol llama a
// setHeader con props inline (actions/breadcrumb, referencia nueva en cada
// render). Con un solo contexto combinado, cada setHeader cambia el value
// memoizado entero y re-renderiza tambien a los consumidores de searchQuery;
// si ese consumidor es quien renderiza el PageHeader con esas props inline,
// el ciclo setHeader -> re-render -> nuevas props -> setHeader no converge
// nunca (React error #185, visto en vivo en /prevencion/pdtp/obligaciones).
const HeaderContext = React.createContext<HeaderContextValue | null>(null)
const SearchContext = React.createContext<SearchContextValue | null>(null)

// Dos contextos más, por la misma razón que los de arriba: los filtros sólo
// necesitan `register` (estable) y no deben re-renderizarse cuando cambia la
// cuenta, que sólo le importa al TopBar.
const WorksiteFilterRegisterContext = React.createContext<(() => () => void) | null>(null)
const WorksiteFilterCountContext = React.createContext(0)

export function ShellHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = React.useState<ShellHeaderState>({})
  const [searchQuery, setSearchQuery] = React.useState("")
  const [worksiteFilterCount, setWorksiteFilterCount] = React.useState(0)

  const headerValue = React.useMemo(() => ({ header, setHeader }), [header])
  const searchValue = React.useMemo(() => ({ searchQuery, setSearchQuery }), [searchQuery])
  const register = React.useCallback(() => {
    setWorksiteFilterCount((count) => count + 1)
    return () => setWorksiteFilterCount((count) => count - 1)
  }, [])

  return (
    <HeaderContext.Provider value={headerValue}>
      <SearchContext.Provider value={searchValue}>
        <WorksiteFilterRegisterContext.Provider value={register}>
          <WorksiteFilterCountContext.Provider value={worksiteFilterCount}>
            {children}
          </WorksiteFilterCountContext.Provider>
        </WorksiteFilterRegisterContext.Provider>
      </SearchContext.Provider>
    </HeaderContext.Provider>
  )
}

/**
 * Declara que la vista tiene un selector de faena a la vista. Mientras esté
 * montado, el TopBar oculta el chip "Tu faena": al lado de un filtro en otra
 * faena se leía como "la pantalla no cambió".
 *
 * Va en el componente del filtro y no en la página para que el chip se oculte
 * exactamente cuando el selector existe — varios lo muestran sólo con más de
 * una faena visible. Pasa `active = false` en ese caso. No lo uses en
 * formularios que eligen una faena: eso es un dato, no el alcance de la vista.
 */
export function useWorksiteFilterPresence(active = true) {
  const register = React.useContext(WorksiteFilterRegisterContext)
  React.useEffect(() => {
    if (!active || !register) return
    return register()
  }, [active, register])
}

/** Para páginas de servidor: el mismo aviso como componente sin salida visual. */
export function WorksiteFilterPresence({ active = true }: { active?: boolean }) {
  useWorksiteFilterPresence(active)
  return null
}

/** `true` si la vista declaró un selector de faena. Lo lee el TopBar. */
export function useHasWorksiteFilter(): boolean {
  return React.useContext(WorksiteFilterCountContext) > 0
}

export function useShellHeader() {
  const context = React.useContext(HeaderContext)
  if (!context) {
    throw new Error("useShellHeader must be used within ShellHeaderProvider")
  }

  return context
}

export function useSafeShellHeader(): SearchContextValue {
  const context = React.useContext(SearchContext)
  return context ?? { searchQuery: "", setSearchQuery: () => {} }
}
