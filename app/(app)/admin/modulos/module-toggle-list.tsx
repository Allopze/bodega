"use client"

import { useActionState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  toggleModuleAction,
  toggleSubmoduleAction,
} from "./actions"

interface SubmoduleToggle {
  label:    string
  href:     string
  enabled:  boolean
  permissions?: readonly string[]
}

interface ModuleToggle {
  id:          string
  label:       string
  enabled:     boolean
  submodules:  SubmoduleToggle[]
}

interface ModuleToggleListProps {
  moduleToggles: ModuleToggle[]
}

const INITIAL_STATE = { ok: false, message: undefined as string | undefined }

export function ModuleToggleList({ moduleToggles }: ModuleToggleListProps) {
  const enabledCount = moduleToggles.filter((m) => m.enabled).length

  if (moduleToggles.length === 0) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-8 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          No hay módulos registrados en el sistema.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <span className="text-sm text-[var(--color-text-muted)]">
          {enabledCount} de {moduleToggles.length} módulos activos
        </span>
        <div className="h-3 w-px bg-[var(--color-border)]" aria-hidden />
        <span className="text-xs text-[var(--color-text-faint)]">
          Los cambios surten efecto inmediato en la navegación
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {moduleToggles.map((mod) => (
          <ModuleCard key={mod.id} mod={mod} />
        ))}
      </div>
    </div>
  )
}

function ModuleCard({ mod }: { mod: ModuleToggle }) {
  const [state, formAction, isPending] = useActionState(
    async () => toggleModuleAction(mod.id, !mod.enabled),
    INITIAL_STATE,
  )

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Módulo actualizado")
    } else if (state.message) {
      toast.error(state.message)
    }
  }, [state])

  const enabledSubmodules = mod.submodules.filter((s) => s.enabled).length

  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition-opacity duration-[var(--duration-fast)]",
        !mod.enabled && "opacity-70",
      )}
    >
      {/* Module header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={cn(
              "text-sm font-semibold",
              mod.enabled ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
            )}>
              {mod.label}
            </h3>
            <span className="rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {mod.id}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            {mod.submodules.length} submódulo{mod.submodules.length !== 1 ? "s" : ""}
            {mod.submodules.length > 0 && ` · ${enabledSubmodules} activos`}
          </p>
        </div>

        <Switch
          checked={mod.enabled}
          disabled={isPending}
          label={`${mod.enabled ? "Desactivar" : "Activar"} módulo ${mod.label}`}
          onCheckedChange={() => formAction()}
        />
      </div>

      {/* Submodules */}
      {mod.submodules.length > 0 && (
        <div className={cn(
          "border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]",
          !mod.enabled && "pointer-events-none opacity-50",
        )}>
          {mod.submodules.map((sub) => (
            <SubmoduleRow
              key={sub.href}
              moduleId={mod.id}
              sub={sub}
              moduleEnabled={mod.enabled}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SubmoduleRow({
  moduleId,
  sub,
  moduleEnabled,
}: {
  moduleId: string
  sub: SubmoduleToggle
  moduleEnabled: boolean
}) {
  const [state, formAction, isPending] = useActionState(
    async () => toggleSubmoduleAction(moduleId, sub.href, !sub.enabled),
    INITIAL_STATE,
  )

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Submódulo actualizado")
    } else if (state.message) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 pl-8">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-sm",
            sub.enabled ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
          )}>
            {sub.label}
          </span>
          {sub.permissions && sub.permissions.length > 0 && (
            <span className="rounded-[var(--radius-full)] bg-[var(--color-primary-tint)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-primary-ink)]">
              permiso
            </span>
          )}
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-faint)]">
          {sub.href}
        </p>
      </div>

      <Switch
        checked={sub.enabled}
        disabled={isPending || !moduleEnabled}
        label={`${sub.enabled ? "Desactivar" : "Activar"} ${sub.label}`}
        onCheckedChange={() => formAction()}
      />
    </div>
  )
}
