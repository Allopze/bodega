"use client"

import { Plus, X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OT_ITEM_MAX_PER_KIND } from "@/lib/mantencion/work-order-states"

/**
 * Lista numerada de hasta 12 líneas, como las del talonario («TRABAJOS ANEXOS» y
 * «REGISTRO DE MANTENCIONES SOLICITADAS»). Controlada: quien la usa guarda el
 * arreglo y descarta las líneas vacías al enviar.
 */
export function OtItemListEditor({
  idPrefix,
  legend,
  helper,
  placeholder,
  items,
  onChange,
  error,
  disabled,
}: {
  idPrefix: string
  legend: string
  helper?: string
  placeholder: string
  items: string[]
  onChange: (next: string[]) => void
  error?: string
  disabled?: boolean
}) {
  const atMax = items.length >= OT_ITEM_MAX_PER_KIND
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">{legend}</legend>
      {helper && <p className="-mt-1 text-xs text-[var(--color-text-subtle)]">{helper}</p>}
      {items.length > 0 && (
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <span aria-hidden className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{index + 1}</span>
              <Input
                id={`${idPrefix}-${index}`}
                aria-label={`${legend}, línea ${index + 1}`}
                value={item}
                maxLength={300}
                placeholder={placeholder}
                onChange={(event) => onChange(items.map((current, i) => (i === index ? event.target.value : current)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Quitar la línea ${index + 1} de ${legend}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <X size={14} aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" disabled={atMax} onClick={() => onChange([...items, ""])}>
          <Plus size={14} className="mr-1.5" aria-hidden />
          Agregar línea
        </Button>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]" aria-live="polite">
          {items.length}/{OT_ITEM_MAX_PER_KIND}
        </span>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </fieldset>
  )
}
