"use client"

import { ExportLink } from "@/components/ui/export-button"
import Link from "next/link"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

export function ComprasActions({
  canCreate,
  exportHref,
}: {
  canCreate: boolean
  exportHref?: string | null
}) {
  const exportButton = exportHref ? (
    <ExportLink href={exportHref} />
  ) : null

  if (!canCreate) return exportButton

  return (
    <div className="flex items-center gap-2">
      {exportButton}
      <Button variant="primary" size="sm" asChild>
        <Link href="/compras/nueva">
          <Plus weight="bold" size={14} />
          Nueva OC
        </Link>
      </Button>
    </div>
  )
}
