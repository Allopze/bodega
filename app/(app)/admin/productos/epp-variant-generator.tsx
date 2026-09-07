"use client"

import * as React from "react"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { X } from "@phosphor-icons/react"
import { Tooltip } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AttributeMultiValues, SizeFamilyOption } from "./product-form.types"

// ── Attribute presets for quick-add ────────────────────────────────────────────

/**
 * El color no es una talla y no vive en `size_catalog`: sigue siendo una lista
 * fija. Las tallas llegan por props desde la base.
 */
const COLOR_PRESET = {
  name: "Color",
  options: ["Amarillo", "Azul", "Blanco", "Gris", "Negro", "Naranja", "Rojo", "Verde"],
} as const

type AttributePreset = { name: string; options: string[]; sizeFamily?: string }

function buildPresets(sizeFamilies: SizeFamilyOption[]): AttributePreset[] {
  return [
    ...sizeFamilies.map((family) => ({
      name: family.attributeName,
      options: family.codes,
      sizeFamily: family.family,
    })),
    { name: COLOR_PRESET.name, options: [...COLOR_PRESET.options] },
  ]
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface VariantGeneratorProps {
  singleVariant?: boolean
  wizAttrs: AttributeMultiValues[]
  isEpp: boolean
  sizeFamilies: SizeFamilyOption[]
  onToggleAttr: (preset: { name: string; options: string[]; sizeFamily?: string }) => void
  onUpdateAttrValues: (name: string, values: string[]) => void
  /**
   * Quita un atributo del asistente. Separado de `onToggleAttr` a propósito:
   * ese sólo enumera los presets (así que no podía quitar un atributo venido de
   * una plantilla de categoría) y además fuerza `isEpp = true`, que no es lo que
   * significa borrar una fila.
   */
  onRemoveAttr: (name: string) => void
  onGenerate: () => void
  generating: boolean
  variantLimit: number
  variantWarnAt: number
  onMarkDirty: () => void
  /**
   * En el modo "añadir variante", los valores que ya existen en la familia se
   * muestran como chips deshabilitados (con aviso) en lugar de preseleccionados:
   * cada variante es un producto y no se puede recrear una combinación idéntica.
   * Mapa por nombre de atributo normalizado → valores ya usados.
   */
  existingValuesByAttr?: Record<string, string[]>
}

// ── Add a value not covered by the preset ─────────────────────────────────────

/**
 * Los presets cubren las tallas y colores habituales, pero no todos: una talla
 * 47, un color corporativo o cualquier valor de una plantilla de categoría no
 * tenían forma de entrar. Enter agrega sin enviar el formulario (el asistente
 * vive dentro de un `<form>`, así que el submit por defecto crearía el producto
 * a medio configurar).
 */
function AddValueInput({ attributeName, onAdd, buttonLabel = "Agregar" }: { attributeName: string; onAdd: (value: string) => void; buttonLabel?: string }) {
  const [draft, setDraft] = React.useState("")

  function commit() {
    const value = draft.trim()
    if (!value) return
    onAdd(value)
    setDraft("")
  }

  return (
    <div className="mt-2 flex gap-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          commit()
        }}
        placeholder="Agregar valor..."
        aria-label={`Agregar un valor a ${attributeName}`}
        className="h-7 max-w-40 text-xs"
      />
      <Button type="button" variant="ghost" size="sm" onClick={commit} disabled={!draft.trim()}>
        {buttonLabel}
      </Button>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VariantGenerator({
  wizAttrs,
  singleVariant = false,
  isEpp,
  sizeFamilies,
  onToggleAttr,
  onUpdateAttrValues,
  onRemoveAttr,
  onGenerate,
  generating,
  variantLimit,
  variantWarnAt,
  onMarkDirty,
  existingValuesByAttr,
}: VariantGeneratorProps) {
  const presets = React.useMemo(() => buildPresets(sizeFamilies), [sizeFamilies])

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        {singleVariant ? "Edita los atributos de este ítem. Para registrar otra talla o color con stock independiente, crea otra variante." : "Define talla, color u otros atributos. Cada combinación se creará como un producto con stock independiente."}
      </p>

      {/* Atributos chip selector */}
      <div className="rounded-(--radius) border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Atajos para EPP</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const isActive = wizAttrs.some((a) => normalizeAttributeName(a.name) === normalizeAttributeName(preset.name))
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

      <div>
        <p className="text-sm font-medium">Otro atributo (medida, material, modelo…)</p>
        <AddValueInput buttonLabel="Agregar atributo" attributeName="nuevo atributo" onAdd={(name) => {
          if (wizAttrs.some((a) => normalizeAttributeName(a.name) === normalizeAttributeName(name))) return
          onMarkDirty()
          onToggleAttr({ name, options: [] })
        }} />
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
            const preset = presets.find((p) => normalizeAttributeName(p.name) === normalizeAttributeName(attr.name))
            // Un atributo que no es preset (viene de una plantilla de categoría)
            // trae sus opciones en `values`: sin este fallback se dibujaba una
            // caja sin chips, `values` quedaba vacío y «Generar variantes» no se
            // habilitaba nunca — y como el toggle de arriba sólo lista presets,
            // tampoco se podía quitar. El paso 2 quedaba muerto.
            // En añadir-variante los existentes de la familia se suman también a
            // las opciones (deshabilitadas) aunque `values` empiece vacío.
            const existingOptions = existingValuesByAttr?.[normalizeAttributeName(attr.name)] ?? []
            const options = [...new Set([...(preset?.options ?? []), ...attr.values, ...existingOptions])]
            return (
              <div key={attr.name} className="rounded-(--radius) border border-[var(--color-border)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{attr.name}</p>
                  <button
                    type="button"
                    onClick={() => { onMarkDirty(); onRemoveAttr(attr.name) }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-(--radius-sm) text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
                    aria-label={`Quitar atributo ${attr.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const isSelected = attr.values.includes(option)
                    // En "añadir variante" un valor que ya existe en la familia
                    // no puede volverse a crear: se muestra deshabilitado, no
                    // preseleccionado, para que no parezca una combinación nueva.
                    const exists = !!existingValuesByAttr
                      ?.[normalizeAttributeName(attr.name)]
                      ?.some((v) => v.trim().toLocaleLowerCase("es-CL") === option.trim().toLocaleLowerCase("es-CL"))
                    return (
                      <Tooltip
                        key={option}
                        content={exists ? "Ya existe una variante con este valor en la familia" : undefined}
                        side="top"
                        delayDuration={300}
                      >
                        <button
                          aria-pressed={isSelected}
                          type="button"
                          disabled={exists}
                          onClick={() => {
                            onMarkDirty()
                            onUpdateAttrValues(attr.name, isSelected
                              ? attr.values.filter((v) => v !== option)
                              : singleVariant ? [option] : [...attr.values, option])
                          }}
                          className={`rounded-(--radius-sm) px-3 py-1.5 text-xs font-medium transition-colors ${
                            exists
                              ? "cursor-not-allowed border border-dashed border-[var(--color-border)] text-[var(--color-text-faint)]"
                              : isSelected
                                ? "bg-[var(--color-primary)] text-white"
                                : "bg-[var(--color-surface)] text-[var(--color-text-subtle)] border border-[var(--color-border)] hover:border-[var(--color-primary)]"
                          }`}
                        >
                          {isSelected && "✓ "}{option}{exists && " · existe"}
                        </button>
                      </Tooltip>
                    )
                  })}
                </div>
                <AddValueInput
                  attributeName={attr.name}
                  onAdd={(value) => {
                    if (attr.values.includes(value)) return
                    // No permitir agregar a mano un valor que ya existe en la
                    // familia: el chip ya está deshabilitado con ese aviso.
                    const existsInFamily = existingOptions.some(
                      (v) => v.trim().toLocaleLowerCase("es-CL") === value.trim().toLocaleLowerCase("es-CL"),
                    )
                    if (existsInFamily) return
                    onMarkDirty()
                    onUpdateAttrValues(attr.name, singleVariant ? [value] : [...attr.values, value])
                  }}
                />
              </div>
            )
          })}

          {/* Generate variants button */}
          {!singleVariant && (() => {
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
