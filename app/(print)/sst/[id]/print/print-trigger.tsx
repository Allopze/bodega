"use client"

import { ArrowLeft, Printer } from "@phosphor-icons/react"
import { useState } from "react"

export function PrintTrigger({ backHref, suggestedFilename }: { backHref: string; suggestedFilename: string }) {
  const [isPreparing, setIsPreparing] = useState(false)

  async function handlePrint() {
    if (isPreparing) return
    setIsPreparing(true)
    try {
      window.focus()
      await waitForPrintReady()
      window.print()
    } finally {
      setIsPreparing(false)
    }
  }

  return (
    <div className="print-toolbar">
      <button
        onClick={handlePrint}
        className="print-action print-action-primary"
        disabled={isPreparing}
      >
        <Printer size={15} weight="bold" aria-hidden />
        {isPreparing ? "Preparando PDF..." : "Guardar PDF / Imprimir"}
      </button>
      <a href={backHref} className="print-action print-action-secondary">
        <ArrowLeft size={15} weight="bold" aria-hidden />
        Volver al Acta
      </a>
      <span className="print-filename">Nombre sugerido: {suggestedFilename}</span>
    </div>
  )
}

async function waitForPrintReady() {
  await Promise.all([waitForFonts(), waitForImages()])
  await nextFrame()
  await nextFrame()
}

async function waitForFonts() {
  if (!("fonts" in document)) return
  await document.fonts.ready
}

async function waitForImages() {
  const images = Array.from(document.images)
  await Promise.all(
    images.map(async (image) => {
      if (image.complete && image.naturalWidth > 0) return
      if (image.complete) return
      if ("decode" in image) {
        try {
          await image.decode()
          return
        } catch {
          // Fall back to load/error events below.
        }
      }
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true })
        image.addEventListener("error", () => resolve(), { once: true })
      })
    }),
  )
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}
