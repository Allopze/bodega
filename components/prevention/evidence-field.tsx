"use client"

import * as React from "react"
import { FileInput } from "@/components/ui/file-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"

/**
 * Campo de evidencia con las dos vías que el contrato acepta: subir el archivo
 * a la plataforma, o pegar el enlace a un documento que ya vive fuera.
 *
 * Existe porque la simplificación de 2026-09-14 hizo la evidencia obligatoria
 * en Campañas y CGRD sin darles dónde subirla: el campo pedía "archivo subido"
 * y sólo aceptaba una URL. El archivo se sube apenas se elige —y no al enviar
 * el formulario— para que el error de subida se vea en su propio campo y no
 * arrastre consigo el resto del acto (marcar la campaña, publicar la matriz).
 *
 * `value` es lo que viaja al servidor: una ruta `storage/...` cuando se subió
 * un archivo, o la URL tal cual cuando se pegó una.
 */
export function EvidenceField({
  label,
  helper,
  uploadUrl,
  value,
  onChange,
  disabled,
}: {
  label: string
  helper?: string
  /** Endpoint POST que recibe `file` y devuelve `{ path }`. */
  uploadUrl: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const uploaded = value.startsWith("storage/")

  async function handleFile(file: File | null) {
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.set("file", file)
      const response = await fetch(uploadUrl, { method: "POST", body })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(json.error ?? "No se pudo subir el archivo.")
        return
      }
      onChange(json.path as string)
    } catch {
      setError("No se pudo subir el archivo.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <FileInput accept=".pdf,.png,.jpg,.jpeg" disabled={disabled || uploading} onChange={handleFile} />
      {uploading && <p className="text-xs text-[var(--color-text-muted)]">Subiendo…</p>}
      {uploaded && !uploading && (
        <p className="text-xs text-[var(--color-success-ink)]">Archivo subido y adjunto.</p>
      )}
      {!uploaded && (
        <Input
          placeholder="…o pega el enlace: https://..."
          value={value}
          disabled={disabled || uploading}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      {helper && !error && <p className="text-xs text-[var(--color-text-muted)]">{helper}</p>}
    </div>
  )
}
