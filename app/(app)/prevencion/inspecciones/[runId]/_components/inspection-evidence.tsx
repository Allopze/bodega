"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { compressPhoto } from "@/lib/pwa/image-compress"

/**
 * Evidencia fotográfica de una respuesta (función #1).
 *
 * `evidenceReference` existía en el esquema y en el export, y ninguna pantalla
 * adjuntaba nada: una inspección sin foto del hallazgo no sirve como evidencia.
 *
 * La foto cuelga de la respuesta, así que el ítem debe estar respondido y
 * guardado antes de poder adjuntar — de ahí que el control se deshabilite
 * mientras no exista `answerId`.
 */
function inspectionEvidenceFileName(path: string) {
  return path.split("/").pop() ?? ""
}

export function FindingEvidence({ findingId, evidence, editable }: {
  findingId: string
  evidence: { id: string; path: string; caption: string | null }[]
  editable: boolean
}) {
  const [uploadedItems, setUploadedItems] = React.useState<typeof evidence>([])
  const [caption, setCaption] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const items = React.useMemo(() => {
    const byId = new Map(evidence.map((item) => [item.id, item]))
    for (const item of uploadedItems) byId.set(item.id, item)
    return [...byId.values()]
  }, [evidence, uploadedItems])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError("")
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("findingId", findingId)
        body.set("caption", caption)
        const response = await fetch("/api/prevencion/inspecciones/finding-evidence", { method: "POST", body })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(failure.error ?? "No se pudo subir la evidencia.")
        }
        const json = await response.json()
        setUploadedItems((current) => [...current, { id: json.id, path: json.path, caption: json.caption }])
      }
      setCaption("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la evidencia.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && <div className="flex flex-wrap gap-2">{items.map((item) => {
        const name = inspectionEvidenceFileName(item.path)
        return <a key={item.id} href={`/api/prevencion/inspecciones/evidence/${name}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL autenticada y dinámica. */}
          <img src={`/api/prevencion/inspecciones/evidence/${name}`} alt={item.caption ?? "Evidencia del hallazgo"} className="h-16 w-16 rounded border border-[var(--color-border)] object-cover" />
        </a>
      })}</div>}
      {editable && <div className="flex flex-wrap items-end gap-2">
        <Field label="Leyenda de la evidencia"><Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} /></Field>
        <input ref={inputRef} type="file" accept="image/*" multiple aria-label="Adjuntar evidencias del hallazgo" className="sr-only" onChange={(event) => { void upload(event.target.files); event.target.value = "" }} />
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Subiendo…" : "Adjuntar fotos"}</Button>
      </div>}
      {error && <p role="status" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}

export function AnswerEvidence({ answerId, evidence, editable, readyToPersist, ensureAnswerId }: {
  answerId: string | null
  evidence: { id: string; path: string; caption: string | null }[]
  editable: boolean
  /** Existe una respuesta válida en el borrador y puede guardarse. */
  readyToPersist: boolean
  /** Autosave que crea la fila persistida cuando la foto es el primer guardado. */
  ensureAnswerId?: () => Promise<string>
}) {
  const [items, setItems] = React.useState(evidence)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { setItems(evidence) }, [evidence])

  async function upload(files: FileList | null) {
    if (!files?.length || !readyToPersist) return
    setBusy(true)
    setError("")
    try {
      const persistedAnswerId = answerId ?? await ensureAnswerId?.()
      if (!persistedAnswerId) throw new Error("No se pudo guardar la respuesta antes de adjuntar la foto.")
      // Secuencial y no en paralelo: en terreno la conexión es escasa y varias
      // subidas simultáneas se estorban entre sí.
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("answerId", persistedAnswerId)
        const response = await fetch("/api/prevencion/inspecciones/evidence", { method: "POST", body })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(failure.error ?? "No se pudo subir la foto.")
        }
        const json = await response.json()
        setItems((current) => [...current, { id: json.id, path: json.path, caption: null }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <a
              key={item.id}
              href={`/api/prevencion/inspecciones/evidence/${inspectionEvidenceFileName(item.path)}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autenticada; next/image no aporta aquí. */}
              <img
                src={`/api/prevencion/inspecciones/evidence/${inspectionEvidenceFileName(item.path)}`}
                alt={item.caption ?? "Evidencia de la inspección"}
                className="h-16 w-16 rounded border border-[var(--color-border)] object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {editable && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={!readyToPersist || busy}
            onChange={(event) => { void upload(event.target.files); event.target.value = "" }}
            aria-label="Adjuntar evidencia fotográfica"
            className="sr-only"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!readyToPersist || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Subiendo…" : items.length > 0 ? "Agregar fotos" : "Adjuntar fotos"}
          </Button>
          {!readyToPersist && <p className="text-xs text-[var(--color-text-subtle)]">Responde el ítem para habilitar fotografías.</p>}
          {readyToPersist && !answerId && <p className="text-xs text-[var(--color-text-subtle)]">Al elegir una foto, esta respuesta se guardará automáticamente.</p>}
          {busy && <p className="text-xs text-[var(--color-text-subtle)]">Subiendo…</p>}
          {error && <p role="status" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
        </>
      )}
    </div>
  )
}
