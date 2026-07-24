"use client"

import * as React from "react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { FileXls } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"

export interface ExportActionResult {
  ok: boolean
  data?: {
    base64: string
    filename: string
    truncated?: boolean
    rowLimit?: number
  }
  message?: string
}

/**
 * `TFilters` ata la acción a los filtros que se le pasan. Antes ambos eran
 * `unknown`, lo que no compilaba: una acción que espera un tipo concreto no es
 * asignable a una que acepta `unknown` (los parámetros son contravariantes).
 * Se omite `filters` cuando la acción ya viene cerrada sobre sus argumentos.
 */
export interface ExportButtonProps<TFilters = undefined> {
  action: (filters: TFilters) => Promise<ExportActionResult>
  filters?: TFilters
  label?: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  className?: string
}

export function downloadBase64Xlsx(base64: string, filename: string) {
  const link = document.createElement("a")
  link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`
  link.download = filename
  link.click()
}

export function ExportButton<TFilters = undefined>({
  action,
  filters,
  label = "Exportar Excel",
  variant = "secondary",
  size = "sm",
  className,
}: ExportButtonProps<TFilters>) {
  const [loading, setLoading] = React.useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const result = await action(filters as TFilters)
      if (result.ok && result.data) {
        downloadBase64Xlsx(result.data.base64, result.data.filename)
        if (result.data.truncated) {
          const limitStr = result.data.rowLimit ? result.data.rowLimit.toLocaleString("es-CL") : ""
          toast.warning(`Archivo exportado con límite de ${limitStr} filas`)
        } else {
          toast.success("Archivo exportado")
        }
      } else {
        toast.error(result.message ?? "Error al exportar")
      }
    } catch {
      toast.error("Error al exportar")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExport}
      loading={loading}
      className={className}
    >
      <FileXls className="h-4 w-4 mr-1 shrink-0" />
      {label}
    </Button>
  )
}
