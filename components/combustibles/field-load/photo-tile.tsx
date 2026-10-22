"use client"

import * as React from "react"
import Image from "next/image"
import { Camera, CheckCircle } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"

/**
 * Mosaico de foto: toda el área es el botón de la cámara. El `id` del input
 * (`tae-evidence-<tipo>`) es estable porque las pruebas E2E y los lectores de
 * pantalla lo usan.
 */
export function PhotoTile({
  kind,
  label,
  help,
  file,
  compressing,
  error,
  onSelect,
}: {
  kind: TaeEvidenceKind
  label: string
  help?: string
  file?: File
  compressing: boolean
  error?: string | null
  onSelect: (file?: File) => void
}) {
  const [preview, setPreview] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <div className="space-y-1">
      <label
        htmlFor={`tae-evidence-${kind}`}
        className={cn(
          "relative flex min-h-40 cursor-pointer flex-col justify-end overflow-hidden rounded-[var(--radius-md)] border-2 border-dashed text-center",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-primary)]",
          error ? "border-[var(--color-danger)]" : file ? "border-[var(--color-success)]" : "border-[var(--color-border-strong)]",
          "bg-[var(--color-surface-2)]",
        )}
      >
        {preview
          ? <Image unoptimized src={preview} alt={`Vista previa: ${label}`} width={480} height={320} className="absolute inset-0 h-full w-full object-cover" />
          : <Camera className="mx-auto mb-10 text-[var(--color-text-muted)]" size={40} aria-hidden="true" />}
        <span className={cn("relative flex items-center justify-center gap-2 px-3 py-3 text-base font-semibold", preview ? "bg-black/70 text-white" : "text-[var(--color-text)]")}>
          {file && !compressing && <CheckCircle size={20} weight="fill" aria-hidden="true" />}
          {compressing ? "Optimizando foto…" : file ? "Repetir foto" : label}
        </span>
        <input
          id={`tae-evidence-${kind}`}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          aria-describedby={help ? `tae-evidence-${kind}-help` : undefined}
          onChange={(event) => onSelect(event.target.files?.[0])}
        />
      </label>
      {help && <p id={`tae-evidence-${kind}-help`} className="text-sm text-[var(--color-text-muted)]">{help}</p>}
      {error && <p role="alert" className="text-base font-medium text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}
