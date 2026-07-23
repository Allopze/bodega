"use client"

import * as React from "react"
import { Funnel, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetCloseButton, SheetBody,
} from "@/components/admin/sheet"
import { cn } from "@/lib/utils"

export interface ActiveFilterChip {
  key: string
  label: string
  value: string
  displayValue: string
}

export interface FilterToolbarProps {
  children?: React.ReactNode
  overflowFilters?: React.ReactNode
  activeChips?: ActiveFilterChip[]
  onRemoveChip?: (key: string) => void
  onClearAll?: () => void
  hasActiveFilters?: boolean
  activeCount?: number
  className?: string
  actions?: React.ReactNode
}

export function FilterToolbar({
  children,
  overflowFilters,
  activeChips = [],
  onRemoveChip,
  onClearAll,
  hasActiveFilters = false,
  activeCount = 0,
  className,
  actions,
}: FilterToolbarProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false)

  const isFiltered = hasActiveFilters || activeChips.length > 0 || activeCount > 0

  return (
    <div className={cn("flex flex-col gap-2.5 mb-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {children}

          {overflowFilters && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSheetOpen(true)}
                className="relative"
              >
                <Funnel size={14} className="mr-1.5" />
                Más filtros
                {activeCount > 0 && (
                  <Badge variant="signal" size="sm" className="ml-1.5 px-1.5 py-0 font-mono text-[10px]">
                    {activeCount}
                  </Badge>
                )}
              </Button>

              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetContent className="sm:max-w-md">
                  <SheetHeader>
                    <div>
                      <SheetTitle>Filtros avanzados</SheetTitle>
                      <SheetDescription>Aplica parámetros adicionales para reducir los resultados.</SheetDescription>
                    </div>
                    <SheetCloseButton />
                  </SheetHeader>
                  <SheetBody className="space-y-4 py-4">
                    {overflowFilters}
                  </SheetBody>
                  <SheetFooter>
                    {onClearAll && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          onClearAll()
                          setSheetOpen(false)
                        }}
                      >
                        Limpiar
                      </Button>
                    )}
                    <Button type="button" onClick={() => setSheetOpen(false)}>
                      Aplicar filtros
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </>
          )}

          {isFiltered && onClearAll && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X size={12} className="mr-1" />
              Limpiar filtros
            </Button>
          )}
        </div>

        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Removable chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--color-text-subtle)] font-medium">Filtros activos:</span>
          {activeChips.map((chip) => (
            <span
              key={`${chip.key}-${chip.value}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs text-[var(--color-text)]"
            >
              <span className="text-[var(--color-text-subtle)]">{chip.label}:</span>
              <span className="font-medium">{chip.displayValue}</span>
              {onRemoveChip && (
                <button
                  type="button"
                  onClick={() => onRemoveChip(chip.key)}
                  className="ml-0.5 text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                  aria-label={`Eliminar filtro ${chip.label}`}
                >
                  <X size={11} weight="bold" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
