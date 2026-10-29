"use client"

import type { ChangeEvent } from "react"
import { releasePhoto } from "@/lib/mantencion/client/drafts"
import { IconCamera, IconCheck, IconClose } from "./icons"
import { usePhotoCapture, usePhotoUrl, type PhotoCaptureContext } from "./use-photo"
import { FieldError } from "./ui"

function CameraInput({ label, onFile, disabled }: { label: string; onFile: (file: File) => void; disabled: boolean }) {
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) onFile(file)
  }
  // Cámara trasera: es la que se usa para fotografiar el equipo.
  return <input className="sr" type="file" accept="image/*" capture="environment" aria-label={label} onChange={change} disabled={disabled} />
}

/** Una foto obligatoria con nombre propio (filtros / sticker): tomar, ver, repetir o quitar. */
export function PhotoSlot({ number, label, photoId, context, error, onChange }: {
  number: number
  label: string
  photoId: string | null
  context: PhotoCaptureContext
  error?: string | undefined
  onChange: (id: string | null) => void
}) {
  const url = usePhotoUrl(photoId)
  const { capture, busy, error: captureError, clearError } = usePhotoCapture(context)
  const take = async (file: File) => {
    const previous = photoId
    const id = await capture(file)
    if (!id) return
    onChange(id)
    if (previous) void releasePhoto(previous)
  }
  const remove = () => {
    if (!photoId) return
    const previous = photoId
    clearError()
    onChange(null)
    void releasePhoto(previous)
  }
  const shown = error ?? captureError ?? undefined

  return (
    <div className="slot">
      <div className="sloth">
        <strong>{number} · {label}</strong>
        {photoId ? <span className="ok"><IconCheck />Lista</span> : <span className="miss">Falta</span>}
      </div>
      {photoId ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- vista previa de un Blob local (blob:), no pasa por el optimizador */}
          {url ? <img className="ph" src={url} alt={`Foto: ${label}`} /> : <div className="ph" style={{ minHeight: 120 }} />}
          <div className="phrow">
            <label className="btns" style={{ cursor: "pointer" }}>
              {busy ? "Guardando…" : "Repetir foto"}
              <CameraInput label={`Repetir foto de ${label}`} onFile={(file) => { void take(file) }} disabled={busy} />
            </label>
            <button type="button" className="lnk" style={{ alignSelf: "center" }} onClick={remove} aria-label={`Quitar foto de ${label}`}>Quitar</button>
          </div>
        </>
      ) : (
        <label className={`camera${shown ? " bad" : ""}${busy ? " busy" : ""}`}>
          <IconCamera />
          <span>{busy ? "Guardando foto…" : "Tomar foto"}</span>
          <CameraInput label={`Tomar foto de ${label}`} onFile={(file) => { void take(file) }} disabled={busy} />
        </label>
      )}
      <FieldError message={shown} />
    </div>
  )
}

function Thumb({ photoId, index, onRemove }: { photoId: string; index: number; onRemove: (id: string) => void }) {
  const url = usePhotoUrl(photoId)
  return (
    <div className="thumb">
      {/* eslint-disable-next-line @next/next/no-img-element -- vista previa de un Blob local (blob:), no pasa por el optimizador */}
      {url ? <img src={url} alt={`Foto ${index + 1} del trabajo`} /> : <div className="ph" style={{ height: 110 }} />}
      <button type="button" onClick={() => onRemove(photoId)} aria-label={`Quitar foto ${index + 1}`}><IconClose /></button>
    </div>
  )
}

/** De 1 a 3 fotos del repuesto o la reparación (correctiva). */
export function PhotoGrid({ photoIds, max = 3, context, error, onAdd, onRemove }: {
  photoIds: string[]
  max?: number
  context: PhotoCaptureContext
  error?: string | undefined
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { capture, busy, error: captureError } = usePhotoCapture(context)
  const shown = error ?? captureError ?? undefined
  const add = async (file: File) => {
    const id = await capture(file)
    if (id) onAdd(id)
  }
  return (
    <div>
      <div className="phgrid">
        {photoIds.map((id, index) => <Thumb key={id} photoId={id} index={index} onRemove={(removed) => { onRemove(removed); void releasePhoto(removed) }} />)}
        {photoIds.length < max ? (
          <label className={`camera${shown ? " bad" : ""}${busy ? " busy" : ""}`}>
            <IconCamera />
            <span>{busy ? "Guardando foto…" : "Agregar foto"}</span>
            <CameraInput label="Agregar foto del trabajo" onFile={(file) => { void add(file) }} disabled={busy} />
          </label>
        ) : null}
      </div>
      <FieldError message={shown} />
    </div>
  )
}
