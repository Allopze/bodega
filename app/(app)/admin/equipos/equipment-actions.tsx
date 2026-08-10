"use client"

import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EquipmentForm } from "./equipment-form"

export function EquipmentActions({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [formOpen, setFormOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo equipo
      </Button>
      <EquipmentForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editEquipment={null}
        worksites={worksites}
      />
    </>
  )
}
