"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DeliveryForm } from "./delivery-form"
import type {
  DeliveryStockProductOption,
  DeliveryWorkerOption,
  DeliveryWorksiteOption,
} from "./delivery-form.types"

export function DeliveryFormSheet(props: {
  worksites: DeliveryWorksiteOption[]
  workers: DeliveryWorkerOption[]
  stockProducts: DeliveryStockProductOption[]
  today: string
  initialSourceWorksiteId?: string
  initialProductId?: string
  initialRequestItemId?: string
  initialQuantity?: number
  /** `?nueva=1` o un enlace "Entregar": el panel nace abierto. */
  defaultOpen?: boolean
}) {
  const { defaultOpen = false, ...formProps } = props
  const shouldAutoOpen = defaultOpen && props.stockProducts.length > 0
  const [open, setOpen] = React.useState(false)

  // `PageHeader` monta `actions` dos veces —en la TopBar (desktop) y en su
  // cabecera móvil (`lg:hidden`)—, así que nacer abierto abría dos hojas
  // apiladas y Esc cerraba sólo una (verificado en navegador, 2026-10-05). Se
  // abre únicamente la copia cuyo botón se ve; la otra tiene `display: none`.
  const autoOpenChecked = React.useRef(false)
  const triggerRef = React.useCallback((node: HTMLButtonElement | null) => {
    if (!node || autoOpenChecked.current || !shouldAutoOpen) return
    autoOpenChecked.current = true
    if (node.getClientRects().length > 0) setOpen(true)
  }, [shouldAutoOpen])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button ref={triggerRef} type="button" size="sm" onClick={() => setOpen(true)} disabled={props.stockProducts.length === 0}>
        <Plus size={16} weight="bold" /> Registrar entrega
      </Button>
      <SheetContent className="sm:max-w-4xl">
        <SheetHeader>
          <div>
            <SheetTitle>Registrar entrega</SheetTitle>
            <SheetDescription>Elige al trabajador que recibe y los productos del stock de su faena.</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody>
          <DeliveryForm {...formProps} onSuccess={() => setOpen(false)} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
