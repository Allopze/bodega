"use client"

import * as React from "react"

export interface ShellHeaderState {
  title?:       string
  description?: string
  breadcrumb?: React.ReactNode
}

interface ShellHeaderContextValue {
  header:    ShellHeaderState
  setHeader: React.Dispatch<React.SetStateAction<ShellHeaderState>>
}

const ShellHeaderContext = React.createContext<ShellHeaderContextValue | null>(null)

export function ShellHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, setHeader] = React.useState<ShellHeaderState>({})

  return (
    <ShellHeaderContext.Provider value={{ header, setHeader }}>
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
