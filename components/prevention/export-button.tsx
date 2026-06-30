"use client"

import * as React from "react"
import { DownloadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"

interface Props {
  href: string
  label?: string
}

export function PreventionExportButton({ href, label = "Exportar XLSX" }: Props) {
  return (
    <a href={href} download>
      <Button variant="secondary" size="sm" type="button">
        <DownloadSimple size={14} className="mr-1" />
        {label}
      </Button>
    </a>
  )
}