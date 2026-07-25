"use client"

import * as React from "react"
import { Tabs } from "@/components/ui/tabs"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { NavigationItem } from "./use-evaluation-detail"

interface Props {
  navigationItems: NavigationItem[]
  activeSection: string
  setActiveSection: (v: string) => void
  activeNavigationIndex: number
  sectionFocusRequest: number
  children: React.ReactNode
}

export function EvaluationSectionNav({
  navigationItems,
  activeSection,
  setActiveSection,
  activeNavigationIndex,
  sectionFocusRequest,
  children,
}: Props) {
  const selectedLabel = navigationItems[activeNavigationIndex]?.label ?? "Selecciona una sección"
  const sectionTriggerRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (sectionFocusRequest === 0) return
    sectionTriggerRef.current?.scrollIntoView({ block: "center" })
    sectionTriggerRef.current?.focus()
  }, [sectionFocusRequest])

  return (
    <Tabs value={activeSection} onValueChange={setActiveSection}>
      <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-3 shadow-[var(--shadow-card)] sm:p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Sección activa</p>
            <p className="mt-1 truncate text-sm font-semibold text-(--color-text)">
              {selectedLabel}
            </p>
          </div>
          <p className="shrink-0 text-xs font-medium text-text-subtle">
            {activeNavigationIndex + 1} de {navigationItems.length}
          </p>
        </div>

        <div className="mt-3">
          <Select value={activeSection} onValueChange={setActiveSection}>
            <SelectTrigger ref={sectionTriggerRef} aria-label="Seleccionar sección de evaluación" className="h-11">
              <SelectValue placeholder="Selecciona una sección" />
            </SelectTrigger>
            <SelectContent>
              {navigationItems.map((item) => (
                <SelectItem key={item.value} value={item.value} textValue={item.label}>
                  <span title={item.label} className="truncate">{item.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {children}
    </Tabs>
  )
}
