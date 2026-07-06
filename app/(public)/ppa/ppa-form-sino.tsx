"use client"

import { cn } from "@/lib/utils"

interface SiNoProps {
  value: "" | "si" | "no"
  onChange: (v: "si" | "no") => void
  name: string
  /** Marca una respuesta como "de riesgo" (detiene el trabajo) → afordancia roja. */
  dangerOn?: "si" | "no"
}

export function SiNo({ value, onChange, name, dangerOn }: SiNoProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["si", "no"] as const).map((opt) => {
        const active = value === opt
        const danger = active && dangerOn === opt
        return (
          <button
            key={opt}
            type="button"
            data-pressable
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-md border px-4 py-3 text-base font-medium capitalize",
              active
                ? danger
                  ? "border-[var(--color-danger)] bg-[var(--color-danger)] text-white"
                  : "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-ink,white)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)]",
            )}
            data-testid={`${name}-${opt}`}
          >
            {opt === "si" ? "Sí" : "No"}
          </button>
        )
      })}
    </div>
  )
}
