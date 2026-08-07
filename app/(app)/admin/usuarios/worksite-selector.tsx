"use client"

import { Checkbox } from "@/components/ui/checkbox"
import type { Worksite } from "./user-form.helpers"

interface WorksiteSelectorProps {
  worksites: Worksite[]
  selectedIds: string[]
  primaryId: string
  onToggle: (id: string) => void
  onSetPrimary: (id: string) => void
  error?: string
  title?: string
  helper?: string
}

export function WorksiteSelector({
  worksites,
  selectedIds,
  primaryId,
  onToggle,
  onSetPrimary,
  error,
  title = "2. Faenas y alcance",
  helper = "Selecciona dónde ejercerá el acceso. Define una faena principal cuando haya más de una.",
}: WorksiteSelectorProps) {
  return (
    <section className="mt-5" aria-labelledby="user-worksite-title">
      <h3 id="user-worksite-title" className="text-eyebrow mb-1">{title}</h3>
      <p className="mb-2 text-xs text-[var(--color-text-subtle)]">{helper}</p>
      {error && (
        <p role="alert" className="mb-2 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {worksites.length === 0 && (
        <p className="text-xs text-[var(--color-text-subtle)]">No hay faenas registradas</p>
      )}
      <div className="flex flex-col gap-1">
        {worksites.map((ws) => {
          const isChecked = selectedIds.includes(ws.id)
          const isPrimary = primaryId === ws.id && isChecked
          return (
            <div key={ws.id} className="flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-2 hover:bg-[var(--color-surface-2)] sm:min-h-9">
              <Checkbox
                id={`worksite-${ws.id}`}
                checked={isChecked}
                onChange={() => onToggle(ws.id)}
                // Nombre accesible explícito: la etiqueta visible pone el código
                // sin paréntesis y aquí se anuncia "Faena Norte (FN-01)".
                aria-label={`Seleccionar ${ws.name} (${ws.code})`}
                className="mr-1"
                label={<span className="min-w-0 flex-1 truncate">
                  {ws.name}
                  <span className="ml-1.5 font-mono text-xs text-[var(--color-text-subtle)]">{ws.code}</span>
                </span>}
              />
              {isChecked && (
                <button
                  type="button"
                  onClick={() => onSetPrimary(ws.id)}
                  className={[
                    "text-xs px-2 py-0.5 rounded-[var(--radius-sm)] border",
                    "transition-colors duration-[var(--duration-fast)]",
                    isPrimary
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-transparent text-[var(--color-text-subtle)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
                  ].join(" ")}
                >
                  {isPrimary ? "Principal" : "Marcar principal"}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
