"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { RunDocumentInfo } from "./types"

/* ── La planilla física ───────────────────────────────────────────────────── */

/**
 * Visor de la planilla, a la derecha de las respuestas.
 *
 * La foto se queda a la vista mientras se recorren los ítems, y se amplía y
 * reduce para poder ir al detalle de una celda sin perder la lista. Es la
 * condición para que ratificar lo que leyó la máquina sea un acto real y no un
 * clic a ciegas: sin la imagen al lado, confirmar es adivinar.
 *
 * `position: sticky` sólo desde `lg`: en móvil las dos columnas se apilan y
 * fijar la imagen taparía media pantalla.
 */
export function SourceFormViewer({ documents }: { documents: RunDocumentInfo[] }) {
  const [index, setIndex] = React.useState(0)
  const [zoom, setZoom] = React.useState(1)
  const current = documents[Math.min(index, documents.length - 1)]
  if (!current) return null
  const src = `/api/prevencion/inspecciones/documento/${current.path.split("/").pop()}`
  const isPdf = current.path.toLowerCase().endsWith(".pdf")

  return (
    <aside className="space-y-2 lg:sticky lg:top-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Planilla original</h2>
        {!isPdf && <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" aria-label="Reducir la planilla"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>−</Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-[var(--color-text-subtle)]">
            {Math.round(zoom * 100)}%
          </span>
          <Button type="button" size="sm" variant="ghost" aria-label="Ampliar la planilla"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}>+</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setZoom(1)}>Ajustar</Button>
        </div>}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        {isPdf ? (
          <object data={src} type="application/pdf" className="h-[60dvh] min-h-96 w-full" aria-label={current.caption ?? "Planilla PDF del reporte de equipos"}>
            <p className="p-4 text-sm">Este navegador no puede mostrar el PDF. <a className="underline" href={src} target="_blank" rel="noreferrer">Abrir documento</a>.</p>
          </object>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autorizada por sesión; no pasa por el optimizador */
          <img
            src={src}
            alt={current.caption ?? "Planilla del reporte de equipos"}
            className="origin-top-left"
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          />
        )}
      </div>
      {documents.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {documents.map((item, position) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={position === index ? "secondary" : "ghost"}
              onClick={() => { setIndex(position); setZoom(1) }}
            >
              Hoja {position + 1}
            </Button>
          ))}
        </div>
      )}
      {current.caption && <p className="text-xs text-[var(--color-text-subtle)]">{current.caption}</p>}
    </aside>
  )
}

/** Sube la foto de la planilla. Requiere `prevention:inspections:ingest`. */
export function SourceFormUpload({ runId, hasDocuments }: { runId: string; hasDocuments: boolean }) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState("")

  async function upload(file: File) {
    setPending(true)
    setMessage("")
    try {
      const body = new FormData()
      body.append("file", file)
      body.append("runId", runId)
      const response = await fetch("/api/prevencion/inspecciones/documento", { method: "POST", body })
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw new Error(failure?.error ?? "No se pudo subir la planilla.")
      }
      /* INS-10: hasta 2026-09-24 `router.refresh()` volvía a montar la
       * plataforma entera (AppShell exportado como objeto memo) y el borrador
       * en `useState` se iba con él; ya no ocurre. Lo que sostiene la promesa
       * de abajo no es el refresh: es el espejo en el dispositivo
       * (`inspection-draft-storage`), que se restaura al volver a montar. */
      setMessage("Planilla cargada. Tu borrador de respuestas se conserva.")
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir la planilla.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] p-4">
      <h2 className="text-sm font-semibold">{hasDocuments ? "Agregar otra hoja" : "Subir la planilla física"}</h2>
      <p className="text-xs text-[var(--color-text-subtle)]">
        Foto o escaneo del reporte firmado. Queda como evidencia del turno y sirve de referencia para responder los ítems.
      </p>
      <input
        ref={inputRef}
        type="file"
        aria-label={hasDocuments ? "Agregar otra hoja del reporte físico" : "Subir la planilla física"}
        accept="image/jpeg,image/png,application/pdf,.docx,.xlsx,.xls"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ""
        }}
      />
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? "Subiendo…" : "Elegir archivo"}
      </Button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  )
}
