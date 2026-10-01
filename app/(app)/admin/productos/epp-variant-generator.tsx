"use client"

import * as React from "react"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { isSizeAttributeName, normalizeSizeLabel } from "@/lib/products/product-size"
import { X } from "@phosphor-icons/react"
import { Tooltip } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AttributeMultiValues, SizeFamilyOption } from "./product-form.types"
import { defaultScaleCodes, resolveSizeScale, sizeScaleLabel, suggestSizeScale } from "./size-scale.helpers"

/**
 * El color no es una talla y no vive en `size_catalog`: sigue siendo una lista
 * fija. Las tallas llegan por props desde la base.
 */
const COLOR_PRESET = {
  name: "Color",
  options: ["Amarillo", "Azul", "Blanco", "Gris", "Negro", "Naranja", "Rojo", "Verde"],
} as const

// ── Props ─────────────────────────────────────────────────────────────────────

export interface VariantGeneratorProps {
  singleVariant?: boolean
  /**
   * Añadir-variante: los ejes son los de la familia. Se puede marcar qué tallas
   * agregar, pero no cambiar de escala ni quitar el eje, o las variantes nuevas
   * no compartirían atributos con las existentes.
   */
  lockedAxes?: boolean
  /** Nombre del producto: de él sale la escala sugerida. */
  productName: string
  wizAttrs: AttributeMultiValues[]
  sizeFamilies: SizeFamilyOption[]
  /** Reemplaza el eje de talla por esta escala (con sus tallas típicas), o lo quita con `null`. */
  onSetSizeScale: (scale: SizeFamilyOption | null) => void
  onToggleAttr: (preset: { name: string; options: string[]; sizeFamily?: string }) => void
  onUpdateAttrValues: (name: string, values: string[]) => void
  /**
   * Quita un atributo del asistente. Separado de `onToggleAttr` a propósito:
   * ese sólo enumera los presets (así que no podía quitar un atributo venido de
   * una plantilla de categoría).
   */
  onRemoveAttr: (name: string) => void
  /** Productos que se crearán con lo marcado (la vista previa se arma sola). */
  variantCount: number
  variantLimit: number
  variantWarnAt: number
  onMarkDirty: () => void
  /**
   * En el modo "añadir variante", los valores que ya existen en la familia: se
   * ofrecen como opciones aunque la escala no los traiga. Mapa por nombre de
   * atributo normalizado → valores ya usados.
   */
  existingValuesByAttr?: Record<string, string[]>
  /**
   * Los que además no se pueden volver a marcar porque ya son una combinación
   * entera (ver `blockedValuesByAttr` en el formulario): chip deshabilitado
   * con «existe». Mismo formato que `existingValuesByAttr`.
   */
  blockedValuesByAttr?: Record<string, string[]>
}

// ── Add a value not covered by the preset ─────────────────────────────────────

/**
 * Los presets cubren las tallas y colores habituales, pero no todos: una talla
 * 47, un color corporativo o cualquier valor de una plantilla de categoría no
 * tenían forma de entrar. Enter agrega sin enviar el formulario (el asistente
 * vive dentro de un `<form>`, así que el submit por defecto crearía el producto
 * a medio configurar).
 */
function AddValueInput({ label, placeholder, onAdd, buttonLabel = "Agregar" }: { label: string; placeholder: string; onAdd: (value: string) => void; buttonLabel?: string }) {
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
        placeholder={placeholder}
        aria-label={label}
        className="h-8 max-w-56 text-sm"
      />
      <Button type="button" variant="secondary" size="sm" onClick={commit} disabled={!draft.trim()}>
        {buttonLabel}
      </Button>
    </div>
  )
}

// ── Chips ─────────────────────────────────────────────────────────────────────

function ValueChip({ option, selected, exists, onToggle }: { option: string; selected: boolean; exists: boolean; onToggle: () => void }) {
  return (
    <Tooltip content={exists ? "Ya existe una variante con este valor" : undefined} side="top" delayDuration={300}>
      <button
        aria-pressed={selected}
        type="button"
        disabled={exists}
        onClick={onToggle}
        className={`min-w-11 rounded-(--radius-sm) px-3 py-1.5 text-sm font-medium transition-colors ${
          exists
            ? "cursor-not-allowed border border-dashed border-[var(--color-border)] text-[var(--color-text-faint)]"
            : selected
              ? "bg-[var(--color-primary)] text-white"
              : "bg-[var(--color-surface)] text-[var(--color-text-subtle)] border border-[var(--color-border)] hover:border-[var(--color-primary)]"
        }`}
      >
        {selected && "✓ "}{option}{exists && " · existe"}
      </button>
    </Tooltip>
  )
}

function sameValue(attrName: string, left: string, right: string): boolean {
  if (isSizeAttributeName(attrName)) return normalizeSizeLabel(left) === normalizeSizeLabel(right)
  return left.trim().toLocaleLowerCase("es-CL") === right.trim().toLocaleLowerCase("es-CL")
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VariantGenerator({
  wizAttrs,
  singleVariant = false,
  lockedAxes = false,
  productName,
  sizeFamilies,
  onSetSizeScale,
  onToggleAttr,
  onUpdateAttrValues,
  onRemoveAttr,
  variantCount,
  variantLimit,
  variantWarnAt,
  onMarkDirty,
  existingValuesByAttr,
  blockedValuesByAttr,
}: VariantGeneratorProps) {
  const sizeAttr = wizAttrs.find((attr) => isSizeAttributeName(attr.name)) ?? null
  const otherAttrs = wizAttrs.filter((attr) => attr !== sizeAttr)
  const activeScale = sizeAttr ? resolveSizeScale(sizeAttr, productName, sizeFamilies) : null
  const suggested = suggestSizeScale(productName, sizeFamilies)
  const hasColor = wizAttrs.some((a) => normalizeAttributeName(a.name) === normalizeAttributeName(COLOR_PRESET.name))

  const existingFor = (attrName: string) => existingValuesByAttr?.[normalizeAttributeName(attrName)] ?? []
  const isExisting = (attrName: string, value: string) =>
    (blockedValuesByAttr?.[normalizeAttributeName(attrName)] ?? []).some((v) => sameValue(attrName, v, value))

  function toggleValue(attr: AttributeMultiValues, option: string) {
    onMarkDirty()
    const selected = attr.values.includes(option)
    onUpdateAttrValues(attr.name, selected
      ? attr.values.filter((v) => v !== option)
      : singleVariant ? [option] : [...attr.values, option])
  }

  function addValue(attr: AttributeMultiValues, value: string) {
    if (attr.values.some((v) => sameValue(attr.name, v, value))) return
    // No permitir agregar a mano un valor que ya existe en la familia: el chip
    // ya está deshabilitado con ese aviso.
    if (isExisting(attr.name, value)) return
    onMarkDirty()
    onUpdateAttrValues(attr.name, singleVariant ? [value] : [...attr.values, value])
  }

  /** Opciones de un eje: las de la escala/preset, las marcadas y las ya existentes. */
  function optionsFor(attr: AttributeMultiValues, base: readonly string[]) {
    const options: string[] = []
    for (const value of [...base, ...attr.values, ...existingFor(attr.name)]) {
      if (!options.some((known) => sameValue(attr.name, known, value))) options.push(value)
    }
    return options
  }

  const sizeOptions = sizeAttr ? optionsFor(sizeAttr, activeScale?.codes ?? []) : []
  const selectable = (values: readonly string[]) => values.filter((value) => sizeAttr && !isExisting(sizeAttr.name, value))

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-text-muted)]">
        {singleVariant
          ? "Edita la talla y los atributos de este ítem. Para otra talla con stock propio, usa «Agregar tallas» en el listado."
          : "Marca las tallas y colores que existen. Cada combinación se crea como un producto con su propio stock."}
      </p>

      {/* ── Tallas ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="wiz-sizes-title" className="rounded-(--radius) border border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="wiz-sizes-title" className="text-sm font-semibold">Tallas</h3>
          {!lockedAxes && suggested && (!activeScale || activeScale.family !== suggested.family) && (
            <button
              type="button"
              className="text-xs font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline"
              onClick={() => { onMarkDirty(); onSetSizeScale(suggested) }}
            >
              Usar {sizeScaleLabel(suggested)}, sugerida para «{productName.trim()}»
            </button>
          )}
        </div>

        {lockedAxes ? (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {sizeAttr
              ? `Escala de la familia: ${activeScale ? sizeScaleLabel(activeScale) : sizeAttr.name}. Marca las que faltan.`
              : "Esta familia no se separa por talla."}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Escala de tallas">
            {sizeFamilies.map((option) => {
              const checked = activeScale?.family === option.family
              return (
                <button
                  key={option.family}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => { if (checked) return; onMarkDirty(); onSetSizeScale(option) }}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                    checked
                      ? "bg-[var(--color-primary)] text-white font-semibold"
                      : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {sizeScaleLabel(option)}
                  {suggested?.family === option.family && !checked && <span className="ml-1 text-xs text-[var(--color-text-faint)]">· sugerida</span>}
                </button>
              )
            })}
            <button
              type="button"
              role="radio"
              aria-checked={!sizeAttr}
              onClick={() => { if (!sizeAttr) return; onMarkDirty(); onSetSizeScale(null) }}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                !sizeAttr
                  ? "bg-[var(--color-primary)] text-white font-semibold"
                  : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)] hover:border-[var(--color-primary)]"
              }`}
            >
              Sin tallas
            </button>
          </div>
        )}

        {sizeAttr && (
          <div className="mt-4">
            {!singleVariant && (
              <div className="mb-2 flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-[var(--color-text-subtle)]">
                  {sizeAttr.values.length} marcada{sizeAttr.values.length === 1 ? "" : "s"} ·
                </span>
                {activeScale && activeScale.defaultCodes && activeScale.defaultCodes.length < activeScale.codes.length && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { onMarkDirty(); onUpdateAttrValues(sizeAttr.name, selectable(defaultScaleCodes(activeScale))) }}>
                    Típicas ({activeScale.defaultCodes[0]}–{activeScale.defaultCodes.at(-1)})
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => { onMarkDirty(); onUpdateAttrValues(sizeAttr.name, selectable(sizeOptions)) }}>
                  Todas
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { onMarkDirty(); onUpdateAttrValues(sizeAttr.name, []) }}>
                  Ninguna
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {sizeOptions.map((option) => (
                <ValueChip
                  key={option}
                  option={option}
                  selected={sizeAttr.values.includes(option)}
                  exists={isExisting(sizeAttr.name, option)}
                  onToggle={() => toggleValue(sizeAttr, option)}
                />
              ))}
            </div>
            <AddValueInput
              label={`Agregar otra talla a ${sizeAttr.name}`}
              placeholder="Otra talla (p. ej. 47)"
              onAdd={(value) => addValue(sizeAttr, value)}
            />
          </div>
        )}
      </section>

      {/* ── Otros atributos ────────────────────────────────────────────────── */}
      <section aria-labelledby="wiz-other-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="wiz-other-title" className="text-sm font-semibold">Color y otros atributos <span className="font-normal text-[var(--color-text-subtle)]">(opcional)</span></h3>
          {!lockedAxes && !hasColor && (
            <Button type="button" variant="secondary" size="sm" onClick={() => { onMarkDirty(); onToggleAttr({ name: COLOR_PRESET.name, options: [...COLOR_PRESET.options] }) }}>
              + Color
            </Button>
          )}
        </div>

        {otherAttrs.map((attr) => {
          const isColor = normalizeAttributeName(attr.name) === normalizeAttributeName(COLOR_PRESET.name)
          // Un atributo que no es preset (viene de una plantilla de categoría)
          // trae sus opciones en `values`: sin este fallback se dibujaba una
          // caja sin chips y el paso quedaba muerto.
          const options = optionsFor(attr, isColor ? COLOR_PRESET.options : [])
          return (
            <div key={attr.name} className="rounded-(--radius) border border-[var(--color-border)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{attr.name}</p>
                {!lockedAxes && (
                  <button
                    type="button"
                    onClick={() => { onMarkDirty(); onRemoveAttr(attr.name) }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-(--radius-sm) text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
                    aria-label={`Quitar atributo ${attr.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                  <ValueChip
                    key={option}
                    option={option}
                    selected={attr.values.includes(option)}
                    exists={isExisting(attr.name, option)}
                    onToggle={() => toggleValue(attr, option)}
                  />
                ))}
              </div>
              <AddValueInput
                label={`Agregar un valor a ${attr.name}`}
                placeholder={`Otro valor de ${attr.name.toLocaleLowerCase("es-CL")}`}
                onAdd={(value) => addValue(attr, value)}
              />
            </div>
          )
        })}

        {!lockedAxes && (
          <AddValueInput
            label="Nombre del nuevo atributo"
            placeholder="Nuevo atributo (p. ej. Material)"
            buttonLabel="Agregar atributo"
            onAdd={(name) => {
              if (wizAttrs.some((a) => normalizeAttributeName(a.name) === normalizeAttributeName(name))) return
              onMarkDirty()
              onToggleAttr({ name, options: [] })
            }}
          />
        )}
      </section>

      {/* ── Resumen ────────────────────────────────────────────────────────── */}
      {!singleVariant && (() => {
        const someEmpty = wizAttrs.some((a) => a.values.length === 0)
        const message = wizAttrs.length === 0
          ? "Sin tallas ni atributos: se creará un solo producto."
          : someEmpty
            ? `Marca al menos un valor en ${wizAttrs.filter((a) => a.values.length === 0).map((a) => `«${a.name}»`).join(" y ")}, o quítalo.`
            : variantCount > variantLimit
              ? `${variantCount} combinaciones: el máximo es ${variantLimit}. Desmarca valores.`
              : variantCount === 1
                ? "Se creará 1 producto."
                : `Se crearán ${variantCount} productos, uno por combinación.`
        const tone = someEmpty || variantCount > variantLimit
          ? "text-[var(--color-warning-ink)]"
          : "text-[var(--color-text-muted)]"
        return (
          <p role="status" className={`text-sm ${tone}`}>
            {message}
            {!someEmpty && variantCount > variantWarnAt && variantCount <= variantLimit && ` Cerca del máximo (${variantLimit}).`}
          </p>
        )
      })()}
    </div>
  )
}
