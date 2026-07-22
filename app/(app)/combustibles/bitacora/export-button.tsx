"use client"

import { useState } from "react"
import { FileXls } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { exportFuelLogAction, exportFuelLogSelectionAction } from "./actions"
import type { FuelLogFilters, FuelLogSource } from "@/lib/combustibles/fuel-log"

function downloadXlsx(base64: string, filename: string) {
  const link = document.createElement("a")
  link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`
  link.download = filename
  link.click()
}

export function BitacoraExportButton({ filters }: { filters: FuelLogFilters }) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const result = await exportFuelLogAction(filters)
      if (result.ok && result.data) {
        downloadXlsx(result.data.base64, result.data.filename)
        if (result.data.truncated) toast.warning("Archivo exportado con límite de filas alcanzado")
        else toast.success("Archivo exportado")
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
      {loading ? "Exportando…" : "Exportar Excel"}
    </Button>
  )
}

export function BitacoraSelectionExport({ selection }: { selection: Array<{ source: FuelLogSource; id: string }> }) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const result = await exportFuelLogSelectionAction(selection)
      if (result.ok && result.data) {
        downloadXlsx(result.data.base64, result.data.filename)
        toast.success("Selección exportada")
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
      {loading ? "Exportando…" : "Exportar seleccionadas"}
    </Button>
  )
}
