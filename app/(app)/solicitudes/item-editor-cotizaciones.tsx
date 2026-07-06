"use client"

import * as React from "react"
import { FilePdf, Trash, Upload, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Field } from "@/components/ui/field"
import type { ItemRow } from "./request-form.types"
import type { PendingCotizacion } from "./request-form.types"

interface Props {
  item: ItemRow
  requestType: string
  maxFileSizeMb: number
  readOnly: boolean
  onUpdate: (patch: Partial<ItemRow>) => void
}

export function ItemEditorCotizaciones({ item, requestType, maxFileSizeMb, readOnly, onUpdate }: Props) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cotizacionesRef = React.useRef(item.cotizaciones)
  React.useEffect(() => { cotizacionesRef.current = item.cotizaciones })

  const handleFileSelect = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newCots: PendingCotizacion[] = []
    for (const file of Array.from(files)) {
      if (file.size > maxFileSizeMb * 1024 * 1024) {
        toast.error(`${file.name} excede el tamaño máximo de ${maxFileSizeMb}MB`)
        continue
      }
      newCots.push({
        _id: crypto.randomUUID(),
        file,
        fileName: file.name,
        fileSize: file.size,
      })
    }
    if (newCots.length > 0) {
      onUpdate({ cotizaciones: [...cotizacionesRef.current, ...newCots] })
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [onUpdate, maxFileSizeMb])

  const removeCotizacion = React.useCallback((id: string) => {
    onUpdate({ cotizaciones: cotizacionesRef.current.filter((c) => c._id !== id) })
  }, [onUpdate])

  if (readOnly) return null

  return (
    <div className="ml-8 space-y-3">
      <div className="flex items-center justify-between">
        <Field label="Cotizaciones" required={requestType === "repuestos"} htmlFor={`cot-${item._key}`}>
          <p className="text-[11px] text-(--color-text-subtle) mt-0.5">
            {requestType === "repuestos"
              ? "Mínimo 3 cotizaciones. Si tienes menos, adjunta las que tengas."
              : "Adjunta cotizaciones de proveedores (PDF, JPG o PNG)."}
          </p>
        </Field>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        id={`cot-${item._key}`}
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        onChange={handleFileSelect}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-(--radius) border border-dashed border-(--color-border) bg-(--color-surface-2) px-4 py-3 text-xs text-(--color-text-subtle) hover:border-(--color-primary) hover:text-(--color-primary) transition-colors duration-(--duration-fast)"
      >
        <Upload size={14} />
        {item.cotizaciones?.length
          ? "Agregar más cotizaciones"
          : "Seleccionar archivos (PDF, JPG, PNG)"}
      </button>

      {item.cotizaciones?.length > 0 && (
        <ul className="space-y-1.5">
          {item.cotizaciones.map((cot) => (
            <li
              key={cot._id}
              className="flex items-center gap-2 rounded-(--radius) border border-(--color-border) bg-(--color-surface) px-3 py-2"
            >
              <FilePdf size={14} className="shrink-0 text-(--color-text-subtle)" />
              <span className="flex-1 truncate text-xs text-(--color-text)">{cot.fileName}</span>
              <span className="text-[10px] text-(--color-text-muted)">
                {(cot.fileSize / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={() => removeCotizacion(cot._id)}
                className="shrink-0 p-0.5 rounded text-(--color-text-subtle) hover:text-(--color-danger) hover:bg-(--color-danger-tint) transition-colors"
                aria-label="Quitar archivo"
              >
                <Trash size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {requestType === "repuestos" && (item.cotizaciones?.length ?? 0) > 0 && (item.cotizaciones?.length ?? 0) < 3 && (
        <p className="flex items-center gap-1.5 text-[11px] text-(--color-warning-ink)">
          <Warning size={12} className="shrink-0" />
          Se recomienda un mínimo de 3 cotizaciones para repuestos.
        </p>
      )}
    </div>
  )
}
