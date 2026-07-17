"use client"

import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

export const OPEN_DELIVERY_FORM_EVENT = "entregas:open-form"

export function DeliveryFormTrigger() {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => window.dispatchEvent(new Event(OPEN_DELIVERY_FORM_EVENT))}
    >
      <Plus className="mr-1.5 h-4 w-4" />
      Registrar entrega
    </Button>
  )
}
