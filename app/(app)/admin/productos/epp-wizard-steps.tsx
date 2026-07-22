"use client"

import { cn } from "@/lib/utils"
import type { WizardStep } from "./product-form.types"

interface StepConfig {
  step: WizardStep
  label: string
  description: string
}

const STEPS: StepConfig[] = [
  { step: 1, label: "Información", description: "Datos generales del producto" },
  { step: 2, label: "Atributos", description: "Talla, color y variantes" },
  { step: 3, label: "Proveedor", description: "Proveedor preferido" },
]

interface Props {
  currentStep: WizardStep
}

export function StepIndicator({ currentStep }: Props) {
  return (
    <div className="mb-6" role="navigation" aria-label="Progreso del asistente">
      {/* Desktop: horizontal row */}
      <div className="hidden sm:flex items-center gap-0">
        {STEPS.map((s, index) => {
          const isCompleted = currentStep > s.step
          const isCurrent = currentStep === s.step
          const isUpcoming = currentStep < s.step

          return (
            <div key={s.step} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <div className="flex items-center gap-2.5">
                {/* Circle */}
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-[var(--duration-fast)]",
                    isCompleted && "bg-[var(--color-primary)] text-white",
                    isCurrent && "border-2 border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]",
                    isUpcoming && "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-subtle)]",
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 7.5L5.5 11L12 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    s.step
                  )}
                </div>

                {/* Label (desktop only) */}
                <div className="hidden lg:block">
                  <p className={cn(
                    "text-sm font-medium leading-tight transition-colors",
                    isCurrent && "text-[var(--color-text)]",
                    isCompleted && "text-[var(--color-text-subtle)]",
                    isUpcoming && "text-[var(--color-text-faint)]",
                  )}>
                    {s.label}
                  </p>
                  <p className={cn(
                    "text-xs leading-tight transition-colors",
                    isCurrent && "text-[var(--color-text-muted)]",
                    isCompleted && "text-[var(--color-text-faint)]",
                    isUpcoming && "text-[var(--color-text-faint)]",
                  )}>
                    {s.description}
                  </p>
                </div>
              </div>

              {/* Connector line (between steps, not after last) */}
              {index < STEPS.length - 1 && (
                <div className="mx-4 flex-1 h-px min-w-6">
                  <div className={cn(
                    "h-full rounded-full transition-colors duration-[var(--duration-default)]",
                    isCompleted ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]",
                  )} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Mobile: simplified progress bar */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((s) => (
            <div key={s.step} className="flex flex-col items-center gap-1 flex-1">
              <div
                className={cn(
                  "h-2 w-full rounded-full transition-colors duration-[var(--duration-fast)]",
                  currentStep >= s.step ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-2)]",
                )}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-center text-[var(--color-text-subtle)]">
          Paso {currentStep} de 3: {STEPS[currentStep - 1]!.label}
        </p>
      </div>
    </div>
  )
}
