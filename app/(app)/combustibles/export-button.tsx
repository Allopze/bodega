"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FileXls } from "@phosphor-icons/react"
import { exportFuelLoadsXlsxAction } from "./actions"
import { toast } from "@/lib/toast"

interface ExportButtonProps {
  filters?: Record<string, string | undefined>
}

export function ExportXlsxButton({ filters }: ExportButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const result = await exportFuelLoadsXlsxAction(filters)
      if (result.ok && result.data) {
        const link = document.createElement("a")
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data.base64}`
        link.download = result.data.filename
        link.click()
        if (result.data.truncated) {
          toast.warning(`Archivo exportado con límite de ${result.data.rowLimit.toLocaleString("es-CL")} filas`)
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
    <Button variant="secondary" size="sm" onClick={handleExport} disabled={loading}>
      <FileXls className="h-4 w-4 mr-1" />
      {loading ? "Exportando..." : "Exportar Excel"}
    </Button>
  )
}
