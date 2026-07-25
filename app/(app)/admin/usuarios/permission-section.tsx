"use client"

import { Lock } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { getModuleLabel, type Permission } from "./user-form.helpers"

interface PermissionSectionProps {
  groupedPermissions: Array<{ module: string; permissions: Permission[] }>
  selectedRoleIds: string[]
  selectedPermissionIds: string[]
  directPermissionLabel: string
  activeModules: string[]
  onTogglePermission: (id: string) => void
  onToggleAllInModule: (group: { module: string; permissions: Permission[] }) => void
  error?: string
}

export function PermissionSection({
  groupedPermissions,
  selectedRoleIds,
  selectedPermissionIds,
  directPermissionLabel,
  activeModules,
  onTogglePermission,
  onToggleAllInModule,
  error,
}: PermissionSectionProps) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-eyebrow">Permisos</p>
        <span className="rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
          {directPermissionLabel}
        </span>
      </div>

      {activeModules.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {activeModules.map((mod) => (
            <span
              key={mod}
              className="inline-flex items-center rounded-[var(--radius-full)] bg-[var(--color-primary-tint)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-ink)]"
            >
              {getModuleLabel(mod)}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-2 text-xs text-[var(--color-danger)]">{error}</p>
      )}
      {groupedPermissions.length === 0 && (
        <p className="text-xs text-[var(--color-text-subtle)]">No hay permisos registrados</p>
      )}

      <div role="region" aria-label="Permisos de usuario" className="space-y-4">
        {groupedPermissions.map((group) => {
          const toggleableIds = group.permissions
            .filter((p) => !p.roleIds.some((rid) => selectedRoleIds.includes(rid)))
            .map((p) => p.id)
          const allToggled =
            toggleableIds.length > 0 && toggleableIds.every((id) => selectedPermissionIds.includes(id))
          return (
            <section key={group.module}>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-eyebrow">{getModuleLabel(group.module)}</p>
                {toggleableIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleAllInModule(group)}
                    className="text-[11px] font-medium text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--color-primary-strong)]"
                  >
                    {allToggled ? "Quitar todos" : "Seleccionar todos"}
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {group.permissions.map((permission) => {
                  const inheritedByRole = permission.roleIds.some((rid) => selectedRoleIds.includes(rid))
                  const directlyGranted = selectedPermissionIds.includes(permission.id)
                  const active = inheritedByRole || directlyGranted
                  if (inheritedByRole) {
                    return (
                      <div
                        key={permission.id}
                        className="flex h-9 items-center gap-3 rounded-md px-2 opacity-50"
                      >
                        <Lock size={14} weight="bold" className="shrink-0 text-[var(--color-text-faint)]" aria-hidden />
                        <span title={permission.description ?? permission.name} className="flex-1 truncate text-sm text-[var(--color-text-muted)]">
                          {permission.description ?? permission.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--color-text-subtle)]">vía rol</span>
                      </div>
                    )
                  }
                  return (
                    <label
                      key={permission.id}
                      className={cn(
                        "flex h-9 cursor-pointer items-center gap-3 rounded-md px-2",
                        "transition-colors duration-[var(--duration-fast)] ease-out",
                        "hover:bg-[var(--color-surface-2)]",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={directlyGranted}
                        onChange={() => onTogglePermission(permission.id)}
                        aria-label={permission.description ?? permission.name}
                        className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span
                        className={cn(
                          "flex-1 truncate text-sm transition-colors duration-[var(--duration-fast)]",
                          active ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
                        )}
                      >
                        {permission.description ?? permission.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-faint)]">
                        {permission.name}
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
