"use client"

import { CaretDown } from "@phosphor-icons/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { VALID_COLORS } from "@/lib/services/epp-import.types"
import { AddValueInput, ValueChip } from "../../epp-variant-generator"

function splitColors(value: string | null): string[] {
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []
}

function sameColor(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase("es-CL") === right.trim().toLocaleLowerCase("es-CL")
}

/**
 * Un EPP puede venir en varios colores (un casco amarillo y blanco, un chaleco
 * amarillo y naranja). El `Select` de un solo valor que había acá mostraba
 * vacía la fila «Amarillo, Naranja» —el valor no era ninguna de sus opciones—
 * y elegir uno pisaba al otro; tampoco dejaba escribir un color fuera de la
 * lista. Los chips y el campo para agregar son los del asistente de productos.
 *
 * El valor viaja como texto separado por comas, el formato que
 * `buildMultiValueAttr` y `validateReviewedNormalized` ya entienden.
 */
export function ColorCell({ value, onChange }: { value: string | null; onChange: (next: string | null) => void }) {
  const selected = splitColors(value)
  const options = [...VALID_COLORS]
  for (const color of selected) if (!options.some((known) => sameColor(known, color))) options.push(color)

  function commit(next: string[]) {
    onChange(next.length > 0 ? next.join(", ") : null)
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={selected.length > 0 ? `Color: ${selected.join(", ")}` : "Color: sin color"}
        title={selected.length > 0 ? selected.join(", ") : undefined}
        className="flex h-7 w-28 items-center justify-between gap-1 rounded-(--radius-lg) border border-(--color-border-control) bg-(--color-surface) px-2 text-xs hover:border-(--color-border-control-hover) focus:outline-none focus:border-(--color-primary) focus:ring-2 focus:ring-(--color-primary-line)"
      >
        <span className={`min-w-0 flex-1 truncate text-left ${selected.length > 0 ? "text-(--color-text)" : "text-(--color-text-subtle)"}`}>
          {selected.length > 0 ? selected.join(", ") : "Color"}
        </span>
        <CaretDown className="h-3 w-3 shrink-0 text-(--color-text-subtle)" weight="bold" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <p className="mb-2 text-xs text-(--color-text-muted)">Marca todos los colores en que viene este EPP.</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colores">
          {options.map((option) => {
            const isSelected = selected.some((color) => sameColor(color, option))
            return (
              <ValueChip
                key={option}
                option={option}
                selected={isSelected}
                onToggle={() => commit(isSelected ? selected.filter((color) => !sameColor(color, option)) : [...selected, option])}
              />
            )
          })}
        </div>
        <AddValueInput
          label="Agregar otro color"
          placeholder="Otro color"
          onAdd={(color) => { if (!selected.some((known) => sameColor(known, color))) commit([...selected, color]) }}
        />
      </PopoverContent>
    </Popover>
  )
}
