"use client"

import * as React from "react"

export interface ShellHeaderState {
  title?:       string
  description?: string
  breadcrumb?: React.ReactNode
  actions?:    React.ReactNode
}

interface ShellHeaderContextValue {
  header:       ShellHeaderState
  setHeader:    React.Dispatch<React.SetStateAction<ShellHeaderState>>
  searchQuery:  string
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
}

const ShellHeaderContext = React.createContext<ShellHeaderContextValue | null>(null)

export function ShellHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = React.useState<ShellHeaderState>({})
  const [searchQuery, setSearchQuery] = React.useState("")

  const value = React.useMemo(
    () => ({ header, setHeader, searchQuery, setSearchQuery }),
    [header, searchQuery],
  )

  return (
    <ShellHeaderContext.Provider value={value}>
      {children}
    </ShellHeaderContext.Provider>
  )
}

export function useShellHeader() {
  const context = React.useContext(ShellHeaderContext)
  if (!context) {
    throw new Error("useShellHeader must be used within ShellHeaderProvider")
  }

  return context
}

export function useSafeShellHeader(): Pick<ShellHeaderContextValue, "searchQuery" | "setSearchQuery"> {
  const context = React.useContext(ShellHeaderContext)
  return context ?? { searchQuery: "", setSearchQuery: () => {} }
}
