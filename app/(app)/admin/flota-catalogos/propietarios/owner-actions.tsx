"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { OwnerForm } from "./owner-form"

/** Alta desde el encabezado de la página (regla 5 de `app/AGENTS.md`); editar vive en cada fila de la lista. */
export function OwnerActions() {
  const [formOpen, setFormOpen] = React.useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nueva empresa
      </Button>

      <OwnerForm
        key="nueva"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editRow={null}
      />
    </>
  )
}
