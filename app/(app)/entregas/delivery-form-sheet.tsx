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
  DeliverableEppOption,
  DeliveryStockProductOption,
  DeliveryWorkerOption,
  DeliveryWorksiteOption,
} from "./delivery-form.types"

export function DeliveryFormSheet(props: {
  worksites: DeliveryWorksiteOption[]
  workers: DeliveryWorkerOption[]
  stockProducts: DeliveryStockProductOption[]
  traceableItems: DeliverableEppOption[]
  initialSourceWorksiteId?: string
  initialRequestItemId?: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={props.stockProducts.length === 0}>
        <Plus size={16} weight="bold" /> Registrar entrega
      </Button>
      <SheetContent className="sm:max-w-4xl">
        <SheetHeader>
          <div>
            <SheetTitle>Registrar entrega</SheetTitle>
            <SheetDescription>Selecciona stock real de bodega y el trabajador que lo recibe.</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody>
          <DeliveryForm {...props} onSuccess={() => setOpen(false)} />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
