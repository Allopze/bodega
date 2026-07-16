"use client"

import * as React from "react"
import { ArrowBendUpLeft, ClipboardText, ArrowsDownUp, Plus, CaretRight, CaretLeft } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
} from "@/components/admin/sheet"
import { ReturnPanel, type ReturnPanelStockOption } from "./return-panel"
import { AdjustPanel, type AdjustPanelStockOption } from "./adjust-panel"
import { PhysicalInventoryPanel, type PhysicalInventoryStockOption } from "./physical-inventory-panel"

type WorksiteOption = { id: string; name: string }
type MovementType = "return" | "count" | "adjust"

/**
 * Punto de entrada único para los tres movimientos de bodega (devolución, conteo
 * físico y ajuste). Antes vivían como tres formularios permanentemente abiertos en
 * un sidebar, con campos casi idénticos — fácil registrar en el panel equivocado.
 * Ahora un solo botón abre un Sheet que primero pregunta *qué* movimiento, y solo
 * entonces muestra ese formulario. Imposible tener dos abiertos a la vez; el stock
 * y el kardex recuperan el ancho completo de la página.
 */
export function BodegaMovementSheet({
  worksites,
  canReturn,
  returnProducts,
  canCount,
  countProducts,
  canAdjust,
  adjustProducts,
}: {
  worksites: WorksiteOption[]
  canReturn: boolean
  returnProducts: ReturnPanelStockOption[]
  canCount: boolean
  countProducts: PhysicalInventoryStockOption[]
  canAdjust: boolean
  adjustProducts: AdjustPanelStockOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState<MovementType | null>(null)

  type Choice = { key: MovementType; label: string; desc: string; icon: React.ReactNode }
  const choices: Choice[] = [
    ...(canReturn ? [{ key: "return" as const, label: "Devolución a stock", desc: "Reingresar EPP no utilizado a la faena.", icon: <ArrowBendUpLeft size={18} /> }] : []),
    ...(canCount ? [{ key: "count" as const, label: "Conteo físico", desc: "Cerrar un conteo con ajuste automático por diferencia.", icon: <ClipboardText size={18} /> }] : []),
    ...(canAdjust ? [{ key: "adjust" as const, label: "Ajuste de inventario", desc: "Corregir una existencia con motivo.", icon: <ArrowsDownUp size={18} /> }] : []),
  ]

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) window.setTimeout(() => setType(null), 200)
  }

  if (choices.length === 0) return null

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Registrar movimiento
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>Registrar movimiento</SheetTitle>
              {type === null && <SheetDescription>Elige el tipo de movimiento a registrar.</SheetDescription>}
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {type === null ? (
              <div className="flex flex-col gap-2">
                {choices.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    onClick={() => setType(choice.key)}
                    className="group flex items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint)"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
                      {choice.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-(--color-text)">{choice.label}</span>
                      <span className="block text-xs text-(--color-text-muted)">{choice.desc}</span>
                    </span>
                    <CaretRight size={16} className="shrink-0 text-(--color-text-faint)" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setType(null)}
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-(--color-text-muted) hover:text-(--color-text)"
                >
                  <CaretLeft size={14} />Elegir otro tipo
                </button>
                {type === "return" && <ReturnPanel products={returnProducts} worksites={worksites} />}
                {type === "count" && <PhysicalInventoryPanel products={countProducts} worksites={worksites} />}
                {type === "adjust" && <AdjustPanel products={adjustProducts} worksites={worksites} />}
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
