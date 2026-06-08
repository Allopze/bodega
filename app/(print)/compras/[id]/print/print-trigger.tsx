"use client"

import { ArrowLeft, Printer } from "@phosphor-icons/react"

export function PrintTrigger({ backHref, suggestedFilename }: { backHref: string; suggestedFilename: string }) {
  return (
    <div className="print-toolbar">
      <button
        onClick={() => window.print()}
        className="print-action print-action-primary"
      >
        <Printer size={15} weight="bold" aria-hidden />
        Guardar PDF / Imprimir
      </button>
      <a
        href={backHref}
        className="print-action print-action-secondary"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden />
        Volver a la OC
      </a>
      <span className="print-filename">Nombre sugerido: {suggestedFilename}</span>
    </div>
  )
}
