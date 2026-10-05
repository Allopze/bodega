"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, DownloadSimple, SpinnerGap } from "@phosphor-icons/react"

export function PrintTrigger({ pdfHref, suggestedFilename }: { pdfHref: string; suggestedFilename: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  /**
   * TIUX-58: «Volver» regresa a donde se abrió el acta (la ficha del activo o
   * la lista de entregas, con sus filtros), no siempre a la lista. Solo se
   * confía en el historial si la página anterior es de esta misma aplicación;
   * un acta abierta desde un enlace externo o una pestaña nueva cae a la lista.
   */
  function goBack() {
    let sameOrigin = false
    try { sameOrigin = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin }
    catch { sameOrigin = false }
    if (sameOrigin && window.history.length > 1) router.back()
    else router.push("/ti/asignaciones")
  }

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
      <button type="button" onClick={goBack} className="print-action print-action-secondary">
        <ArrowLeft size={15} weight="bold" aria-hidden />Volver
      </button>
      <span className="print-filename">Nombre del archivo: {suggestedFilename}</span>
      {error ? <span className="print-error" role="status">No se pudo generar el PDF ({error}). Intenta nuevamente.</span> : null}
    </div>
  )
}
