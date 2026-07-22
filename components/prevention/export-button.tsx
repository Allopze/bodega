"use client"

import * as React from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

interface Props {
  href: string
  label?: string
}

export function PreventionExportButton({ href, label = "Exportar Excel" }: Props) {
  return (
    <Button asChild variant="secondary" size="sm">
      <a href={href} download>
        <DownloadSimple size={14} className="mr-1" />
        {label}
      </a>
    </Button>
  )
}