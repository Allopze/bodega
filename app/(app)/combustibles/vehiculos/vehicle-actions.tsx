"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { VehicleForm } from "./vehicle-form"

export function VehicleActions({
  worksites,
  users,
}: {
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
}) {
  const [formOpen, setFormOpen] = React.useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo vehículo
      </Button>

      <VehicleForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        worksites={worksites}
        users={users}
        editVehicle={null}
      />
    </>
  )
}
