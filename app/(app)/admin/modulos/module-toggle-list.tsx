"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "@/lib/toast"
import { cn, countOf } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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
          Los cambios surten efecto inmediato en navegación y operación
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

/**
 * Apagar un módulo lo retira de la navegación y bloquea su operación para **todos** los usuarios, y el
 * interruptor lo hacía en un gesto, sin decir qué se llevaba por delante. La
 * confirmación no pide "¿estás seguro?": nombra las pantallas que van a
 * desaparecer, que es la única información con la que se puede decidir.
 *
 * Encender no se confirma a propósito: no retira nada y se deshace con el mismo
 * interruptor. Tampoco se ofrece "Deshacer" en el toast — el rollback real es
 * volver a pulsar, y prometer un undo que no es transaccional es exactamente lo
 * que esta pantalla vino a dejar de hacer.
 */
function disableImpact(labels: string[]): string {
  if (labels.length === 0) {
    return "Dejará de aparecer y sus rutas, acciones y automatizaciones quedarán inactivas para todos los usuarios, incluidos los administradores."
  }
  const shown = labels.slice(0, 4).join(", ")
  const rest = labels.length > 4 ? ` y ${labels.length - 4} más` : ""
  return `Se ocultarán y bloquearán ${countOf(labels.length, "pantalla")} para todos los usuarios, incluidos los administradores: ${shown}${rest}. Sus rutas, acciones y automatizaciones quedarán inactivas.`
}

function ModuleCard({ mod }: { mod: ModuleToggle }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
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

  function requestToggle() {
    if (mod.enabled) setConfirmOpen(true)
    else formAction()
  }

  function confirmDisable() {
    setConfirmOpen(false)
    formAction()
  }

  const enabledSubmodules = mod.submodules.filter((s) => s.enabled).length

  return (
    <section
      // El identificador ya no se pinta; sigue siendo el ancla estable con la
      // que las pruebas distinguen dos tarjetas de nombre parecido.
      data-module-id={mod.id}
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
            {/* El identificador técnico (`purchasing`, `traceability`) se
                retiró: cada módulo ya tiene nombre propio, así que el slug
                sólo aportaba jerga. */}
            <span className={cn(
              "rounded-[var(--radius-full)] px-1.5 py-0.5 text-[10px] font-medium",
              mod.enabled
                ? "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
            )}>
              {mod.enabled ? "Activo" : "Desactivado"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            {countOf(mod.submodules.length, "submódulo")}
            {mod.submodules.length > 0 && ` · ${enabledSubmodules} activos`}
          </p>
        </div>

        <Switch
          checked={mod.enabled}
          disabled={isPending}
          label={`${mod.enabled ? "Desactivar" : "Activar"} módulo ${mod.label}`}
          onCheckedChange={requestToggle}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Desactivar ${mod.label}`}
        description={disableImpact(mod.submodules.filter((s) => s.enabled).map((s) => s.label))}
        confirmLabel="Desactivar módulo"
        variant="warning"
        loading={isPending}
        onConfirm={confirmDisable}
      />

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
  const [confirmOpen, setConfirmOpen] = useState(false)
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

  function requestToggle() {
    if (sub.enabled) setConfirmOpen(true)
    else formAction()
  }

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
              Requiere permiso
            </span>
          )}
        </div>
        {/* La ruta cruda (`/prevencion/pdtp/nuevo`) era el único subtítulo. Se
            sustituye por lo que la pantalla necesita responder: si está visible
            o no. La ruta sigue siendo la clave de la operación, no un rótulo. */}
        <p className="mt-0.5 text-[10px] text-[var(--color-text-faint)]">
          {sub.enabled ? "Visible y operativo" : "Oculto e inactivo para todos"}
        </p>
      </div>

      <Switch
        checked={sub.enabled}
        disabled={isPending || !moduleEnabled}
        label={`${sub.enabled ? "Desactivar" : "Activar"} ${sub.label}`}
        onCheckedChange={requestToggle}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Ocultar ${sub.label}`}
        description="La pantalla dejará de aparecer y sus rutas, acciones y endpoints quedarán inactivos para todos los usuarios, incluidos los administradores."
        confirmLabel="Ocultar pantalla"
        variant="warning"
        loading={isPending}
        onConfirm={() => { setConfirmOpen(false); formAction() }}
      />
    </div>
  )
}
