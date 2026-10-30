"use client"

import * as React from "react"
import { CaretDown, DeviceMobile } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { useOperation } from "@/lib/hooks/use-operation"
import { plural } from "@/lib/mantencion/format"
import { nameKey } from "@/lib/mantencion/normalize"
import type { DeviceCredentialStatus } from "@/lib/services/mantencion/device-credentials"
import type { DevicePersonGroup, DeviceView } from "@/lib/services/mantencion/device-groups"
import { MechanicAppInstallDialog } from "../shared/mechanic-app-install-dialog"
import { revokeDeviceAction } from "@/app/(app)/mantencion/dispositivos/actions"

const STATUS: Record<Exclude<DeviceCredentialStatus, "vigente">, { label: string; variant: "neutral" | "outline" }> = {
  vencida: { label: "Vencida", variant: "neutral" },
  revocada: { label: "Revocada", variant: "outline" },
}

/** Lo que cierra la fila según el estado: «vence el…», «venció el…», «revocada el…». */
const END_LABEL: Record<DeviceCredentialStatus, string> = { vigente: "vence el", vencida: "venció el", revocada: "revocada el" }

interface RevokeTarget { credentialId: string; userName: string; deviceName: string }

/**
 * Dispositivos de la app: una sección por persona con lo que tiene conectado y,
 * plegado, lo que ya no sirve (vencido o revocado). Dos teléfonos del mismo modelo
 * se distinguen por su último uso, su fecha de conexión y el código corto del
 * equipo, que queda como dato secundario. La búsqueda es la de la barra superior.
 */
export function DevicesList({ groups, canRevoke }: { groups: DevicePersonGroup[]; canRevoke: boolean }) {
  const { searchQuery } = useSafeShellHeader()
  const [target, setTarget] = React.useState<RevokeTarget | null>(null)
  const op = useOperation({ feedback: "toast" })

  const needle = nameKey(searchQuery)
  const visible = React.useMemo(() => {
    if (!needle) return groups
    const parts = needle.split(" ")
    const matches = (text: string) => { const key = nameKey(text); return parts.every((part) => key.includes(part)) }
    return groups.flatMap((group) => {
      // Si la búsqueda calza con la persona se muestran todos sus teléfonos; si calza con un teléfono, sólo ése.
      if (matches(`${group.userName} ${group.userEmail}`)) return [group]
      const active = group.active.filter((device) => matches(device.searchText))
      const past = group.past.filter((device) => matches(device.searchText))
      return active.length + past.length > 0 ? [{ ...group, active, past }] : []
    })
  }, [groups, needle])

  function revoke() {
    if (!target) return
    op.run(() => revokeDeviceAction({ credentialId: target.credentialId }), () => setTarget(null), () => setTarget(null))
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<DeviceMobile size={24} aria-hidden />}
        title="Todavía no hay dispositivos conectados"
        description="Cuando un mecánico instala la app y entra con su cuenta, su teléfono aparece aquí y puedes desconectarlo si lo pierde o deja de usarlo."
        action={<MechanicAppInstallDialog />}
      />
    )
  }

  return (
    <>
      {visible.length === 0 ? (
        <p role="status" className="py-8 text-center text-sm text-[var(--color-text-muted)]">Ningún dispositivo coincide con «{searchQuery.trim()}».</p>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {visible.map((group) => (
            <PersonCard
              key={group.userId}
              group={group}
              canRevoke={canRevoke}
              onRevoke={(device) => setTarget({ credentialId: device.id, userName: group.userName, deviceName: device.name })}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => { if (!open) setTarget(null) }}
        title={target ? `Revocar el acceso de ${target.userName}` : "Revocar acceso"}
        description={`El dispositivo «${target?.deviceName ?? ""}» dejará de sincronizar. La persona tendrá que volver a entrar a la app con señal; los registros que tenga sin enviar no se pierden y se envían cuando vuelva a entrar.`}
        confirmLabel="Revocar acceso"
        variant="destructive"
        loading={op.pending}
        onConfirm={revoke}
      />
    </>
  )
}

function PersonCard({ group, canRevoke, onRevoke }: { group: DevicePersonGroup; canRevoke: boolean; onRevoke: (device: DeviceView) => void }) {
  const headingId = `dispositivos-${group.userId}`
  return (
    <Card role="group" aria-labelledby={headingId} className="shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-h3 break-words text-[var(--color-text)]">{group.userName}</h2>
          <p className="break-all text-xs text-[var(--color-text-muted)]">{group.userEmail}</p>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          {group.active.length > 0 ? `${plural(group.active.length, "dispositivo conectado", "dispositivos conectados")}` : "Sin dispositivos conectados"}
        </p>
      </div>
      {group.active.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {group.active.map((device) => <DeviceRow key={device.id} device={device} userName={group.userName} canRevoke={canRevoke} onRevoke={onRevoke} />)}
        </ul>
      )}
      {group.past.length > 0 && (
        <details className="group border-t border-[var(--color-border)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-5 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <span>Ver {plural(group.past.length, "anterior", "anteriores")}</span>
            <CaretDown size={12} aria-hidden className="group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {group.past.map((device) => <DeviceRow key={device.id} device={device} userName={group.userName} canRevoke={false} onRevoke={onRevoke} />)}
          </ul>
        </details>
      )}
    </Card>
  )
}

function DeviceRow({ device, userName, canRevoke, onRevoke }: { device: DeviceView; userName: string; canRevoke: boolean; onRevoke: (device: DeviceView) => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <DeviceMobile size={18} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[var(--color-text)]">
            <span className="break-words">{device.name}</span>
            {/* Lo vigente ya está bajo «N dispositivos conectados»: la etiqueta sólo distingue lo vencido y lo revocado. */}
            {device.status !== "vigente" && <MetaBadge meta={STATUS[device.status]} size="sm" />}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Último uso: {device.lastUse}</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            <span className="whitespace-nowrap">Conectado el {device.connected}</span>
            {" · "}
            <span className="whitespace-nowrap">{END_LABEL[device.status]} {device.endDate}</span>
            {" · "}
            <span className="whitespace-nowrap">Código <span className="font-mono">{device.code}</span></span>
          </p>
        </div>
      </div>
      {canRevoke && device.status === "vigente" && (
        <Button variant="ghost-danger" size="sm" onClick={() => onRevoke(device)} aria-label={`Revocar el acceso de ${userName} en ${device.name}`}>
          Revocar
        </Button>
      )}
    </li>
  )
}
