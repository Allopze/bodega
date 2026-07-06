"use client"

import * as React from "react"

// ─── Search contexts ────────────────────────────────────────────────
// SelectSearchableContext: shared between Trigger and Content when a
// <Select searchable> is used.  The Trigger renders the search input;
// the Content reads the query to filter items.
export const SelectSearchableContext = React.createContext<{
  query:   string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  open:    boolean
} | null>(null)

// SelectFilterContext: always provided by SelectContent so that
// SelectItem can filter itself.  When searchable, the value comes from
// the Trigger's input; otherwise from the Content's own search bar.
export const SelectFilterContext = React.createContext("")

export function getNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join("")
  if (React.isValidElement(node)) {
    return getNodeText((node.props as { children?: React.ReactNode }).children)
  }
  return ""
}
