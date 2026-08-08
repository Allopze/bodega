"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { AnomalyRuleForm } from "./rule-form"

export function NewAnomalyRuleButton() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus size={15} />Nueva regla</Button>
      <AnomalyRuleForm open={open} onClose={() => setOpen(false)} editRow={null} />
    </>
  )
}
