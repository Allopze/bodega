"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, DownloadSimple, SpinnerGap } from "@phosphor-icons/react"

export function PrintTrigger({ pdfHref, suggestedFilename }: { pdfHref: string; suggestedFilename: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(pdfHref)
      if (!response.ok) throw new Error(`Error ${response.status}`)
      const url = URL.createObjectURL(await response.blob())
      const download = document.createElement("a")
      download.href = url
      download.download = suggestedFilename
      document.body.appendChild(download)
      download.click()
      download.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo generar el PDF")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="print-toolbar">
      <button type="button" onClick={handleDownload} disabled={loading} className="print-action print-action-primary">
        {loading ? <><SpinnerGap size={15} weight="bold" className="spin" aria-hidden />Generando…</> : <><DownloadSimple size={15} weight="bold" aria-hidden />Descargar PDF</>}
      </button>
      <Link href="/ti/asignaciones" className="print-action print-action-secondary">
        <ArrowLeft size={15} weight="bold" aria-hidden />Volver a asignaciones
      </Link>
      <span className="print-filename">Nombre del archivo: {suggestedFilename}</span>
      {error ? <span className="print-error" role="status">No se pudo generar el PDF ({error}). Intenta nuevamente.</span> : null}
    </div>
  )
}
