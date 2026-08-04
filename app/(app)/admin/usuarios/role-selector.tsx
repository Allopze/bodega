"use client"

import { Check } from "@phosphor-icons/react"
import type { Role } from "./user-form.helpers"

interface RoleSelectorProps {
  roles: Role[]
  selectedIds: string[]
  onToggle: (id: string) => void
  error?: string
  title?: string
  helper?: string
}

export function RoleSelector({
  roles,
  selectedIds,
  onToggle,
  error,
  title = "1. Rol y acceso base",
  helper = "El rol aplica el acceso habitual. Combina roles sólo cuando la responsabilidad lo exige.",
}: RoleSelectorProps) {
  return (
    <section className="mt-5" aria-labelledby="user-role-title">
      <h3 id="user-role-title" className="text-eyebrow mb-1">{title}</h3>
      <p className="mb-2 text-xs text-[var(--color-text-subtle)]">{helper}</p>
      {error && (
        <p role="alert" className="mb-2 text-xs text-[var(--color-danger)]">{error}</p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {roles.map((role) => {
          const checked = selectedIds.includes(role.id)
          return (
            <button
              key={role.id}
              type="button"
              aria-pressed={checked}
              onClick={() => onToggle(role.id)}
              className={[
                "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] border px-3 py-2 text-left text-xs font-medium sm:min-h-9",
                "transition-[background-color,border-color,color] duration-[var(--duration-fast)]",
                checked
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] hover:bg-[var(--color-primary-strong)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              <span
                data-role-selection-slot="true"
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                {checked && <Check size={11} weight="bold" />}
              </span>
              <span title={role.label} className="truncate">{role.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
