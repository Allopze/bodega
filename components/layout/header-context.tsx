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

export function ShellHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = React.useState<ShellHeaderState>({})
  const [searchQuery, setSearchQuery] = React.useState("")

  const headerValue = React.useMemo(() => ({ header, setHeader }), [header])
  const searchValue = React.useMemo(() => ({ searchQuery, setSearchQuery }), [searchQuery])

  return (
    <HeaderContext.Provider value={headerValue}>
      <SearchContext.Provider value={searchValue}>
        {children}
      </SearchContext.Provider>
    </HeaderContext.Provider>
  )
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
