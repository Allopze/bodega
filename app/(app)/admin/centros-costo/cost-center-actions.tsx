"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { CostCenterForm, type WorksiteOption } from "./cost-center-form"

export function CostCenterActions({ worksites, canCreate }: { worksites: WorksiteOption[]; canCreate: boolean }) {
  const [formOpen, setFormOpen] = React.useState(false)

  if (!canCreate) return null

  return (
    <>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo centro
      </Button>

      <CostCenterForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editCostCenter={null}
        worksites={worksites}
      />
    </>
  )
}
