"use client"

import { useState } from "react"
import { ArrowLeft, DownloadSimple, SpinnerGap } from "@phosphor-icons/react"

export function PrintTrigger({
  backHref,
  pdfHref,
  suggestedFilename,
}: {
  backHref: string
  pdfHref: string
  suggestedFilename: string
}) {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const res = await fetch(pdfHref)
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = suggestedFilename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      // Silently reset — the user can retry.
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="print-toolbar">
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className="print-action print-action-primary"
      >
        {loading ? (
          <>
            <SpinnerGap size={15} weight="bold" className="spin" aria-hidden />
            Generando…
          </>
        ) : (
          <>
            <DownloadSimple size={15} weight="bold" aria-hidden />
            Descargar PDF
          </>
        )}
      </button>
      <a href={backHref} className="print-action print-action-secondary">
        <ArrowLeft size={15} weight="bold" aria-hidden />
        Volver a la OC
      </a>
      <span className="print-filename">Nombre del archivo: {suggestedFilename}</span>
    </div>
  )
}
