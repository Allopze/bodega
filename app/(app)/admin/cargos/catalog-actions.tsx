"use client"

import { useState } from "react"
import { Briefcase, Lightning, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CapabilityForm } from "./capability-form"
import { PositionForm } from "./position-form"
import type { WorkerCapabilityCatalogRow } from "./types"

export function CatalogActions({ capabilities }: { capabilities: WorkerCapabilityCatalogRow[] }) {
  const [positionOpen, setPositionOpen] = useState(false)
  const [capabilityOpen, setCapabilityOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm"><Plus size={14} />Nuevo registro</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPositionOpen(true)}>
            <Briefcase size={16} className="mr-2" />Nuevo cargo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCapabilityOpen(true)}>
            <Lightning size={16} className="mr-2" />Nueva capacidad
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PositionForm open={positionOpen} onClose={() => setPositionOpen(false)} capabilities={capabilities} />
      <CapabilityForm open={capabilityOpen} onClose={() => setCapabilityOpen(false)} />
    </>
  )
}
