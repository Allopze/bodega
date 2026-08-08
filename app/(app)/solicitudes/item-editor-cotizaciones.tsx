"use client"

import * as React from "react"
import { FilePdf, Trash, Upload, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { ItemRow, PendingCotizacion, SupplierOption } from "./request-form.types"

interface Props {
  item: ItemRow
  requestType: string
  maxFileSizeMb: number
  readOnly: boolean
  suppliers: SupplierOption[]
  onUpdate: (patch: Partial<ItemRow>) => void
}

export function ItemEditorCotizaciones({ item, requestType, maxFileSizeMb, readOnly, suppliers, onUpdate }: Props) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cotizacionesRef = React.useRef(item.cotizaciones)
  React.useEffect(() => { cotizacionesRef.current = item.cotizaciones })
  // Qué cotizaciones están en modo "escribir nombre" — puramente de UI, no
  // vive en PendingCotizacion para no inventarle un sentinel al dato.
  const [freeTextIds, setFreeTextIds] = React.useState<Set<string>>(new Set())

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
        totalAmount: "",
        supplierId: "",
        supplierNameFree: "",
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

  const patchCotizacion = React.useCallback((id: string, patch: Partial<PendingCotizacion>) => {
    onUpdate({ cotizaciones: cotizacionesRef.current.map((c) => (c._id === id ? { ...c, ...patch } : c)) })
  }, [onUpdate])

  if (readOnly) return null

  return (
    <div className="ml-8 space-y-3">
      <div className="flex items-center justify-between">
        <Field label="Cotizaciones" required={requestType === "repuestos"} htmlFor={`cot-${item._key}`}>
          <p className="text-[11px] text-(--color-text-subtle) mt-0.5">
            Mínimo 3 cotizaciones, o menos con una justificación en Notas generales. Cada archivo necesita proveedor y monto.
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
        <ul className="space-y-2">
          {item.cotizaciones.map((cot) => {
            const showFreeText = suppliers.length === 0 || freeTextIds.has(cot._id)
            return (
              <li
                key={cot._id}
                className="space-y-2 rounded-(--radius) border border-(--color-border) bg-(--color-surface) px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <FilePdf size={14} className="shrink-0 text-(--color-text-subtle)" />
                  <span title={cot.fileName} className="flex-1 truncate text-xs text-(--color-text)">{cot.fileName}</span>
                  <span className="text-[10px] text-(--color-text-muted)">
                    {(cot.fileSize / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCotizacion(cot._id)}
                    className="shrink-0 size-6 flex items-center justify-center rounded text-(--color-text-subtle) hover:text-(--color-danger) hover:bg-(--color-danger-tint) transition-colors"
                    aria-label="Quitar archivo"
                  >
                    <Trash size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Proveedor" htmlFor={`cot-sup-${cot._id}`}>
                    {!showFreeText ? (
                      <Select
                        value={cot.supplierId || "__free__"}
                        onValueChange={(v) => {
                          if (v === "__free__") {
                            setFreeTextIds((prev) => new Set(prev).add(cot._id))
                            patchCotizacion(cot._id, { supplierId: "" })
                          } else {
                            patchCotizacion(cot._id, { supplierId: v, supplierNameFree: "" })
                          }
                        }}
                      >
                        <SelectTrigger id={`cot-sup-${cot._id}`} className="h-8 text-xs">
                          <SelectValue placeholder="Seleccionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__free__">Escribir nombre...</SelectItem>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`cot-sup-${cot._id}`}
                        className="h-8 text-xs"
                        placeholder="Nombre del proveedor"
                        value={cot.supplierNameFree}
                        onChange={(e) => patchCotizacion(cot._id, { supplierNameFree: e.target.value, supplierId: "" })}
                      />
                    )}
                  </Field>
                  <Field label="Monto" htmlFor={`cot-amt-${cot._id}`}>
                    <Input
                      id={`cot-amt-${cot._id}`}
                      className="h-8 text-xs"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={cot.totalAmount}
                      onChange={(e) => patchCotizacion(cot._id, { totalAmount: e.target.value })}
                    />
                  </Field>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {requestType === "repuestos" && (item.cotizaciones?.length ?? 0) > 0 && (item.cotizaciones?.length ?? 0) < 3 && (
        <p className="flex items-center gap-1.5 text-[11px] text-(--color-warning-ink)">
          <Warning size={12} className="shrink-0" />
          Mínimo 3 cotizaciones, o menos con una justificación en Notas generales.
        </p>
      )}
    </div>
  )
}

/** Una cotización pendiente cuenta como completa cuando tiene proveedor y monto (LOG-9/UX-3). */
export function isCotizacionComplete(cot: PendingCotizacion): boolean {
  const hasSupplier = !!cot.supplierId || cot.supplierNameFree.trim().length > 0
  const amount = Number(cot.totalAmount)
  return hasSupplier && Number.isFinite(amount) && amount > 0
}
