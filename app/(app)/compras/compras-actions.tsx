"use client"

import Link from "next/link"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

export function ComprasActions({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) return null

  return (
    <Button variant="primary" size="sm" asChild>
      <Link href="/compras/nueva">
        <Plus weight="bold" size={14} />
        Nueva OC
      </Link>
    </Button>
  )
}
