"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { AnomalyRuleForm } from "./rule-form"

/** «Nueva regla» para `PageHeader.actions` (y el estado vacío); lleva su propio formulario. */
export function NewAnomalyRuleButton({ existingCodes, label = "Nueva regla", withIcon = true }: {
  existingCodes: readonly string[]
  label?: string
  withIcon?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{withIcon ? <Plus size={15} aria-hidden /> : null}{label}</Button>
      {/* Se monta al abrir: reabrir parte de un formulario limpio. */}
      {open ? <AnomalyRuleForm open onClose={() => setOpen(false)} editRow={null} existingCodes={existingCodes} /> : null}
    </>
  )
}
