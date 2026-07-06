"use client"

import { CheckCircle } from "@phosphor-icons/react"
import type { SelectOption } from "@/lib/sst/types"

interface CargosSelectorProps {
  uid: string
  cargoOptions: SelectOption[]
  selectedCargos: string[]
  cargosRef: React.RefObject<HTMLDivElement | null>
  onToggle: (value: string) => void
  error?: string
}

export function CargosSelector({
  uid,
  cargoOptions,
  selectedCargos,
  cargosRef,
  onToggle,
  error,
}: CargosSelectorProps) {
  return (
    <div className="rounded-(--radius-lg) border border-(--color-border) p-3 sm:p-4">
      <p
        className="text-sm font-medium text-[var(--color-text)] mb-1.5"
        id={`${uid}-cargos-label`}
      >
        Cargos del trabajador
        <span className="ml-0.5 text-danger" aria-hidden>*</span>
      </p>
      <div
        ref={cargosRef}
        role="group"
        aria-labelledby={`${uid}-cargos-label`}
        className="flex flex-wrap gap-2 focus:outline-none"
        tabIndex={-1}
      >
        {cargoOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            aria-pressed={selectedCargos.includes(opt.value)}
            className={[
              "inline-flex h-8 items-center gap-1.5 rounded-(--radius) border px-3 text-sm font-medium",
              "transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-[var(--ease-out)] ",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
              selectedCargos.includes(opt.value)
                ? "bg-(--color-primary) text-white border-(--color-primary) shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
                : "bg-(--color-surface) text-(--color-text) border-(--color-border) hover:border-(--color-border-strong) hover:bg-(--color-surface-2)",
            ].join(" ")}
          >
            {selectedCargos.includes(opt.value) && <CheckCircle size={14} weight="fill" aria-hidden="true" />}
            {opt.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-danger leading-tight" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
