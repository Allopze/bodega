"use client"

import { Tooltip } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import type { AttributeMultiValues } from "./product-form.types"

// ── Attribute presets for quick-add ────────────────────────────────────────────

const EPP_ATTRIBUTE_PRESETS: Array<{ name: string; options: string[]; sizeFamily?: string }> = [
  { name: "Talla",          options: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"], sizeFamily: "ropa" },
  { name: "Talla calzado",  options: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"], sizeFamily: "calzado" },
  { name: "Talla guantes",  options: ["XS", "S", "M", "L", "XL", "2XL"], sizeFamily: "guantes" },
  { name: "Color",          options: ["Amarillo", "Azul", "Blanco", "Gris", "Negro", "Naranja", "Rojo", "Verde"] },
]

// ── Props ─────────────────────────────────────────────────────────────────────

export interface VariantGeneratorProps {
  wizAttrs: AttributeMultiValues[]
  isEpp: boolean
  onToggleAttr: (preset: { name: string; options: string[]; sizeFamily?: string }) => void
  onUpdateAttrValues: (name: string, values: string[]) => void
  onGenerate: () => void
  generating: boolean
  variantLimit: number
  variantWarnAt: number
  onMarkDirty: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VariantGenerator({
  wizAttrs,
  isEpp,
  onToggleAttr,
  onUpdateAttrValues,
  onGenerate,
  generating,
  variantLimit,
  variantWarnAt,
  onMarkDirty,
}: VariantGeneratorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Define los atributos del producto como talla y color. Para productos EPP, selecciona múltiples valores
        para generar automáticamente todas las combinaciones como variantes individuales.
      </p>

      {/* Atributos chip selector */}
      <div className="rounded-(--radius) border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Atajos para EPP</p>
        <div className="flex flex-wrap gap-2">
          {EPP_ATTRIBUTE_PRESETS.map((preset) => {
            const isActive = wizAttrs.some((a) => a.name === preset.name)
            const tooltipContent = isActive
              ? `Quitar «${preset.name}» del producto`
              : preset.options.length <= 4
                ? `Agregar «${preset.name}» (${preset.options.join(", ")})`
                : `Agregar «${preset.name}» (${preset.options.length} opciones)`
            return (
              <Tooltip key={preset.name} content={tooltipContent} side="top" delayDuration={300}>
                <Button
                  type="button"
                  variant={isActive ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => { onMarkDirty(); onToggleAttr(preset) }}
                >
                  {isActive ? "✓ " : "+ "}{preset.name}
                </Button>
              </Tooltip>
            )
          })}
        </div>
      </div>

      {/* Attribute multi-select editors */}
      {wizAttrs.length === 0 ? (
        <p className="text-sm text-[var(--color-text-subtle)] italic">
          Sin atributos. Si no agregas atributos, se creará un solo producto sin variantes.
          {isEpp && " Al marcar atributos arriba, se activará el generador de variantes."}
        </p>
      ) : (
        <div className="space-y-3">
          {wizAttrs.map((attr) => {
            const preset = EPP_ATTRIBUTE_PRESETS.find((p) => p.name === attr.name)
            const options = preset?.options ?? []
            return (
              <div key={attr.name} className="rounded-(--radius) border border-[var(--color-border)] p-3">
                <p className="mb-2 text-sm font-medium">{attr.name}</p>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const isSelected = attr.values.includes(option)
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          onMarkDirty()
                          onUpdateAttrValues(attr.name, isSelected
                            ? attr.values.filter((v) => v !== option)
                            : [...attr.values, option])
                        }}
                        className={`rounded-(--radius-sm) px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? "bg-[var(--color-primary)] text-white"
                            : "bg-[var(--color-surface)] text-[var(--color-text-subtle)] border border-[var(--color-border)] hover:border-[var(--color-primary)]"
                        }`}
                      >
                        {isSelected && "✓ "}{option}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Generate variants button */}
          {(() => {
            const count = wizAttrs.reduce((acc, a) => acc * Math.max(a.values.length, 1), 1)
            const isOverLimit = count > variantLimit
            const isNearLimit = count > variantWarnAt && count <= variantLimit
            const someEmpty = wizAttrs.some((a) => a.values.length === 0)
            const tooltipMsg = someEmpty
              ? "Selecciona al menos un valor en cada atributo"
              : isOverLimit
                ? `El máximo permitido es ${variantLimit} variantes. Reduce los valores.`
                : "Genera todas las combinaciones como productos individuales"
            return (
              <Tooltip content={tooltipMsg} side="top" delayDuration={300}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { onMarkDirty(); onGenerate() }}
                  disabled={generating || someEmpty || isOverLimit}
                >
                  {generating ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent mr-1.5" />
                      Generando...
                    </>
                  ) : someEmpty ? (
                    "selecciona valores"
                  ) : isOverLimit ? (
                    `${count} combinaciones (máx. ${variantLimit})`
                  ) : (
                    <>
                      Generar variantes ({count} combinaciones)
                      {isNearLimit && <span className="ml-1.5 text-[var(--color-warning-ink)]">· máx. {variantLimit}</span>}
                    </>
                  )}
                </Button>
              </Tooltip>
            )
          })()}
        </div>
      )}
    </div>
  )
}
