"use client"

import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { WorksiteForm } from "./worksite-form"

export function FaenasActions() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} />Nueva faena
      </Button>
      <WorksiteForm
        key="nueva"
        open={open}
        onClose={() => setOpen(false)}
        editWorksite={null}
      />
    </>
  )
}
