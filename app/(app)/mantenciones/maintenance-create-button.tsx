"use client"

import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { MaintenanceForm } from "./maintenance-form"

interface Option {
  id: string
  name: string
}

interface VehicleOption {
  id: string
  plate: string
  type: string
}

export function MaintenanceCreateButton({
  vehicles,
  suppliers,
  worksites,
  costCenters,
}: {
  vehicles: VehicleOption[]
  suppliers: Option[]
  worksites: Option[]
  costCenters: Array<Option & { code: string }>
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Nueva mantención
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Nueva mantención</DialogTitle></DialogHeader>
        <MaintenanceForm
          vehicles={vehicles}
          suppliers={suppliers}
          worksites={worksites}
          costCenters={costCenters}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
