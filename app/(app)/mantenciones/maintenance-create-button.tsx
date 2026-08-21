"use client"

import { useState } from "react"
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
} from "@/components/admin/sheet"
import { MaintenanceForm } from "./maintenance-form"

interface Option {
  id: string
  name: string
}

interface VehicleOption {
  id: string
  plate: string
  type: string
  worksiteId: string
}

export function MaintenanceCreateButton({
  vehicles,
  suppliers,
  costCenters,
  canViewCosts,
}: {
  vehicles: VehicleOption[]
  suppliers: Option[]
  costCenters: Array<Option & { code: string; worksiteId: string | null }>
  canViewCosts: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Nueva mantención
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-3xl">
          <SheetHeader>
            <div>
              <SheetTitle>Nueva mantención</SheetTitle>
              <SheetDescription>Guarda el servicio y deja el formulario abierto si necesitas registrar otro.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
        <MaintenanceForm
          vehicles={vehicles}
          suppliers={suppliers}
          costCenters={costCenters}
          canViewCosts={canViewCosts}
        />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
