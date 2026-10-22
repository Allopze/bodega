"use client"

import * as React from "react"
import { Check } from "@phosphor-icons/react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { Input, type InputProps } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Botón de 56px para guantes y dedos grandes: el estándar del formulario de terreno. */
export function BigButton({ className, ...props }: ButtonProps) {
  return <Button {...props} className={cn("h-14 sm:h-14 min-w-14 px-5 text-base font-semibold", className)} />
}

/** Un dato por pantalla: etiqueta grande, ayuda corta y el error justo debajo del campo. */
export function BigField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-lg font-semibold text-[var(--color-text)]">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-sm text-[var(--color-text-muted)]">{hint}</p>}
      {children}
      {error && <p id={`${id}-error`} role="alert" className="text-base font-medium text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}

export function BigInput({ className, error, ...props }: InputProps) {
  return <Input {...props} error={error} className={cn("h-14 sm:h-14 text-xl sm:text-xl", className)} />
}

/** Número grande: teclado decimal, sin flechas ni rueda. */
export function BigNumberInput(props: Omit<InputProps, "type" | "inputMode">) {
  return <BigInput {...props} type="text" inputMode="decimal" autoComplete="off" enterKeyHint="next" className={cn("tabular-nums", props.className)} />
}

export interface BigChoiceOption {
  value: string
  label: string
  description?: string
}

/** Elección de una opción con botones grandes; la elegida se distingue por borde, marca y texto (no solo por color). */
export function BigChoice({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: BigChoiceOption[]
  onChange: (value: string) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border-2 px-4 py-3 text-left",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
              selected
                ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
                : "border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
            )}
          >
            <span className="min-w-0">
              <span className="block text-lg font-semibold">{option.label}</span>
              {option.description && <span className="block text-sm text-[var(--color-text-muted)]">{option.description}</span>}
            </span>
            {selected && <Check size={24} weight="bold" aria-hidden="true" className="shrink-0 text-[var(--color-primary-ink)]" />}
          </button>
        )
      })}
    </div>
  )
}

export function StepNotice({ tone, children }: { tone: "danger" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius-md)] border p-3 text-base",
        tone === "danger"
          ? "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]",
      )}
    >
      {children}
    </div>
  )
}
