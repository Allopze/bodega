"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { AssetTypeForm } from "./asset-type-form"

export function AssetTypeActions({ canCreate }: { canCreate: boolean }) {
  const [formOpen, setFormOpen] = React.useState(false)

  if (!canCreate) return null

  return (
    <>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo tipo
      </Button>

      <AssetTypeForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editRow={null}
      />
    </>
  )
}
