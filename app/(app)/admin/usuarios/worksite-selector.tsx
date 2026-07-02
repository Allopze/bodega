"use client"

import type { Worksite } from "./user-form.helpers"

interface WorksiteSelectorProps {
  worksites: Worksite[]
  selectedIds: string[]
  primaryId: string
  onToggle: (id: string) => void
  onSetPrimary: (id: string) => void
  error?: string
}

export function WorksiteSelector({ worksites, selectedIds, primaryId, onToggle, onSetPrimary, error }: WorksiteSelectorProps) {
  return (
    <div className="mt-5">
      <p className="text-eyebrow mb-2">
        Faenas asignadas
      </p>
      {error && (
        <p className="text-xs text-[var(--color-danger)] mb-2">
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
            <label key={ws.id} className="flex items-center gap-3 py-1.5 px-2 rounded-[var(--radius)] hover:bg-[var(--color-surface-2)] cursor-pointer group">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(ws.id)}
                className="h-4 w-4 accent-[var(--color-primary)] shrink-0"
              />
              <span className="flex-1 text-sm text-[var(--color-text)]">
                {ws.name}
                <span className="ml-1.5 font-mono text-xs text-[var(--color-text-subtle)]">{ws.code}</span>
              </span>
              {isChecked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    onSetPrimary(ws.id)
                  }}
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
            </label>
          )
        })}
      </div>
    </div>
  )
}
