"use client"

import { useState } from "react"
import { FileXls, Upload } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { generateTaeImportReportAction, importTaeHistoryAction } from "./actions"

export function TaeImportReportForm() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [reportGenerated, setReportGenerated] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<{ importedRows: number; validatedRows: number; observedRows: number; invalidRows: number; totalLiters: number } | null>(null)

  async function handleGenerate() {
    if (!file) { toast.error("Selecciona el archivo Excel del histórico TAE"); return }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.set("file", file)
      const result = await generateTaeImportReportAction(formData)
      if (result.ok && result.data) {
        const link = document.createElement("a")
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data.base64}`
        link.download = result.data.filename
        link.click()
        setReportGenerated(true)
        setConfirmed(false)
        toast.success("Reporte generado. Revisa el archivo antes de aprobar cualquier match.")
      } else {
        toast.error(result.message ?? "No se pudo generar el reporte")
      }
    } catch {
      toast.error("No se pudo generar el reporte")
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!file || !confirmed || !reportGenerated) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.set("file", file)
      formData.set("confirmation", "IMPORTAR")
      const response = await importTaeHistoryAction(formData)
      if (response.ok && response.data) {
        setResult(response.data)
        toast.success(response.message)
      } else toast.error(response.message ?? "No se pudo importar el histórico")
    } catch {
      toast.error("No se pudo importar el histórico")
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4 border border-(--color-border) bg-(--color-surface) p-5">
      <div>
        <p className="text-eyebrow">Reporte de mapeo sugerido</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Sube el Excel del control manual TAE. Se genera un XLSX de solo lectura con la faena, equipo, conductor y
          supervisor sugeridos para cada fila (con nivel de confianza), más observaciones de continuidad de sello y
          lecturas. Descarga y revisa ese reporte antes de habilitar la importación definitiva.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 border border-dashed border-(--color-border-strong) bg-(--color-surface-2) px-4 py-3 text-sm">
          <Upload size={16} />
          {file ? file.name : "Seleccionar archivo .xlsx"}
          <input type="file" accept=".xlsx" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReportGenerated(false); setConfirmed(false); setResult(null) }} />
        </label>
        <Button onClick={handleGenerate} disabled={loading || !file}>
          <FileXls className="mr-1 h-4 w-4" />
          {loading ? "Generando..." : "Generar reporte"}
        </Button>
      </div>
      {reportGenerated && !result && <div className="border-t border-(--color-border) pt-4"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Revisé el reporte de mapeo. Confirmo importar las filas con faena válida; las coincidencias inciertas quedarán en estado <strong>Observada</strong>.</span></label><Button className="mt-3" variant="destructive" onClick={handleImport} disabled={loading || !confirmed}>{loading ? "Importando…" : "Importar histórico definitivamente"}</Button></div>}
      {result && <section aria-live="polite" className="border border-[var(--color-success-line)] bg-[var(--color-success-tint)] p-4 text-sm text-[var(--color-success-ink)]"><p className="font-medium">Importación completada</p><p className="mt-1">{result.importedRows.toLocaleString("es-CL")} filas · {result.validatedRows.toLocaleString("es-CL")} validadas · {result.observedRows.toLocaleString("es-CL")} observadas · {result.invalidRows.toLocaleString("es-CL")} no importadas · {Number(result.totalLiters).toLocaleString("es-CL")} L</p></section>}
    </div>
  )
}
