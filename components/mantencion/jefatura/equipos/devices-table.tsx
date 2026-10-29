"use client"

import * as React from "react"
import { DeviceMobile } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import type { DeviceCredentialRow, DeviceCredentialStatus } from "@/lib/services/mantencion/device-credentials"
import { formatDateTime } from "@/lib/utils"
import { revokeDeviceAction } from "@/app/(app)/mantencion/dispositivos/actions"

const STATUS: Record<DeviceCredentialStatus, { label: string; variant: "success" | "neutral" | "outline" }> = {
  vigente: { label: "Vigente", variant: "success" },
  vencida: { label: "Vencida", variant: "neutral" },
  revocada: { label: "Revocada", variant: "outline" },
}

type Row = DeviceCredentialRow & Record<string, unknown>

const COLUMNS = [
  { key: "userName", label: "Persona", sortable: true },
  { key: "label", label: "Dispositivo", sortable: true, sortValue: (row: Row) => row.label ?? row.deviceId },
  { key: "status", label: "Estado", sortable: true },
  { key: "createdAt", label: "Conectado", sortable: true },
  { key: "lastUsedAt", label: "Último uso", sortable: true, sortValue: (row: Row) => row.lastUsedAt ?? "" },
  { key: "expiresAt", label: "Vence", sortable: true },
  { key: "actions", label: "" },
]

const deviceName = (row: DeviceCredentialRow) => row.label?.trim() || "Sin nombre"

/** Dispositivos de la app: quién la tiene conectada, desde cuándo la usa y el botón para desconectarla. */
export function DevicesTable({ rows, canRevoke }: { rows: DeviceCredentialRow[]; canRevoke: boolean }) {
  const [target, setTarget] = React.useState<DeviceCredentialRow | null>(null)
  const op = useOperation({ feedback: "toast" })

  function revoke() {
    if (!target) return
    op.run(() => revokeDeviceAction({ credentialId: target.id }), () => setTarget(null), () => setTarget(null))
  }

  const actionCell = (row: DeviceCredentialRow) => row.status === "vigente" && canRevoke
    ? <Button variant="ghost-danger" size="sm" onClick={() => setTarget(row)} aria-label={`Revocar el acceso de ${row.userName} en ${deviceName(row)}`}>Revocar</Button>
    : null

  return (
    <>
      <DataTable
        caption="Dispositivos de la app del mecánico"
        columns={COLUMNS}
        rows={rows as Row[]}
        searchKeys={["userName", "userEmail", "label", "deviceId"]}
        emptyTitle="Todavía no hay dispositivos conectados"
        emptyDescription="Aparecen cuando un mecánico entra a la app con señal desde su teléfono o tablet."
        hideDensityToggle
        renderRow={(raw) => {
          const row = raw as Row
          return (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.userName}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{row.userEmail}</div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5"><DeviceMobile size={14} aria-hidden className="text-[var(--color-text-subtle)]" />{deviceName(row)}</div>
                <div className="font-mono text-xs text-[var(--color-text-muted)]" title={row.deviceId}>{row.deviceId.slice(0, 8)}</div>
              </TableCell>
              <TableCell><MetaBadge meta={STATUS[row.status]} size="sm" /></TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{formatDateTime(row.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{row.lastUsedAt ? formatDateTime(row.lastUsedAt) : <span className="font-sans text-[var(--color-text-muted)]">Nunca</span>}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{formatDateTime(row.expiresAt)}</TableCell>
              <TableCell className="text-right">{actionCell(row)}</TableCell>
            </TableRow>
          )
        }}
        renderMobileCard={(raw) => {
          const row = raw as Row
          return (
            <div key={row.id} className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{row.userName}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{deviceName(row)}</p>
                </div>
                <MetaBadge meta={STATUS[row.status]} size="sm" />
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Último uso: {row.lastUsedAt ? formatDateTime(row.lastUsedAt) : "nunca"} · vence {formatDateTime(row.expiresAt)}
              </p>
              <div className="mt-2">{actionCell(row)}</div>
            </div>
          )
        }}
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => { if (!open) setTarget(null) }}
        title={target ? `Revocar el acceso de ${target.userName}` : "Revocar acceso"}
        description={`El dispositivo «${target ? deviceName(target) : ""}» dejará de sincronizar. La persona tendrá que volver a entrar a la app con señal; los registros que tenga sin enviar no se pierden y se envían cuando vuelva a entrar.`}
        confirmLabel="Revocar acceso"
        variant="destructive"
        loading={op.pending}
        onConfirm={revoke}
      />
    </>
  )
}
