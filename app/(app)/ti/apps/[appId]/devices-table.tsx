"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { MetaBadge } from "@/components/states/state-badge"
import { DEVICE_STATE_META, type DeviceState } from "@/lib/apps/device-state"
import type { FieldAppId } from "@/lib/apps/field-apps"
import { buildLabel } from "@/lib/build-info"
import { formatDateTime } from "@/lib/utils"
import type { FieldDeviceRow } from "@/lib/services/field-apps/types"

/** La fila de la lectura más los rótulos relativos, calculados en el servidor (sin desajuste al hidratar). */
export interface DeviceTableRow extends FieldDeviceRow {
  lastSeenLabel: string
  pendingSinceLabel: string | null
}

const STATE_ORDER: Record<DeviceState, number> = { error: 0, stuck: 1, silent: 2, ok: 3 }

const LINK_STATUS_LABEL = { revoked: "Revocado", expired: "Vencido" } as const

function columnsFor(app: FieldAppId) {
  return [
    { key: "platform", label: "Teléfono", sortable: true, sortValue: (row: DeviceTableRow) => row.platform },
    { key: "place", label: app === "tae" ? "Enlace de acceso" : "Faena", sortable: true, sortValue: (row: DeviceTableRow) => row.linkLabel ?? row.worksiteName ?? "" },
    { key: "version", label: "Versión", sortable: true, sortValue: (row: DeviceTableRow) => row.builtAt ?? "" },
    { key: "installed", label: "Instalación", sortable: true, sortValue: (row: DeviceTableRow) => (row.installed ? 1 : 0) },
    { key: "pending", label: "Pendientes", sortable: true, sortValue: (row: DeviceTableRow) => row.pendingCount + row.failedCount },
    { key: "error", label: "Último error", sortable: true, sortValue: (row: DeviceTableRow) => row.lastErrorAt ?? "" },
    { key: "lastSeen", label: "Último aviso", sortable: true, sortValue: (row: DeviceTableRow) => row.lastSeenAt },
    { key: "state", label: "Estado", sortable: true, sortValue: (row: DeviceTableRow) => STATE_ORDER[row.state] },
  ]
}

function Identity({ row }: { row: DeviceTableRow }) {
  return (
    <div className="min-w-0">
      {row.userName && <div className="font-medium">{row.userName}</div>}
      <div className={row.userName ? "text-xs text-[var(--color-text-subtle)]" : "font-medium"}>{row.platform}</div>
      <div className="font-mono text-xs text-[var(--color-text-subtle)]" title={row.deviceId}>{row.deviceId.slice(0, 8)}</div>
    </div>
  )
}

function Place({ row }: { row: DeviceTableRow }) {
  if (row.linkLabel) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span>{row.linkLabel}</span>
        {row.linkStatus && row.linkStatus !== "active" && (
          <MetaBadge size="sm" meta={{ label: LINK_STATUS_LABEL[row.linkStatus], variant: "warning" }} title="El enlace con que entró este teléfono ya no sirve." />
        )}
        {row.worksiteName && <span className="w-full text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</span>}
      </div>
    )
  }
  return row.worksiteName ? <span>{row.worksiteName}</span> : <span className="text-[var(--color-text-subtle)]">—</span>
}

function Version({ row }: { row: DeviceTableRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm">{buildLabel(row.builtAt, row.version)}</span>
      {row.versionBehind && (
        <Badge variant="signal" size="sm" title="Corre una versión anterior a la publicada: hay que abrirla con señal para que se actualice.">Atrasada</Badge>
      )}
    </div>
  )
}

function Pending({ row }: { row: DeviceTableRow }) {
  if (row.pendingCount === 0 && row.failedCount === 0) return <span className="text-xs text-[var(--color-text-subtle)]">Sin pendientes</span>
  return (
    <div className="space-y-0.5">
      {row.pendingCount > 0 && (
        <div>
          <span className="font-mono tabular-nums">{row.pendingCount}</span>
          {row.pendingSinceLabel && <span className="text-[var(--color-text-muted)]"> · desde {row.pendingSinceLabel}</span>}
        </div>
      )}
      {row.failedCount > 0 && (
        <div className="text-xs text-[var(--color-danger-ink)]">
          <span className="font-mono tabular-nums">{row.failedCount}</span> {row.failedCount === 1 ? "rechazado" : "rechazados"}
        </div>
      )}
    </div>
  )
}

function LastError({ row }: { row: DeviceTableRow }) {
  if (!row.lastError) return <span className="text-[var(--color-text-subtle)]">—</span>
  return (
    <div className="max-w-[220px]">
      <div className="truncate text-[var(--color-danger-ink)]" title={row.lastError}>{row.lastError}</div>
      {row.lastErrorAt && <div className="text-xs text-[var(--color-text-subtle)]">{formatDateTime(row.lastErrorAt)}</div>}
    </div>
  )
}

function StateBadge({ row }: { row: DeviceTableRow }) {
  const meta = DEVICE_STATE_META[row.state]
  return <MetaBadge meta={meta} title={meta.hint} />
}

export function DevicesTable({ app, rows, filtered }: { app: FieldAppId; rows: DeviceTableRow[]; filtered: boolean }) {
  const columns = columnsFor(app)
  return (
    <DataTable
      caption="Teléfonos con la app instalada o abierta"
      columns={columns}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["platform", "userName", "worksiteName", "linkLabel", "version"]}
      framed={false}
      pageSize={25}
      emptyTitle={filtered ? "Ningún teléfono cumple este filtro" : "Sin teléfonos"}
      emptyDescription={filtered ? "Ningún teléfono está en esta situación." : "Aún no llegan avisos de esta app."}
      emptyAction={filtered ? <Link href={`/ti/apps/${app}`} replace scroll={false} className="text-sm text-[var(--color-primary-ink)] hover:underline">Ver todos</Link> : undefined}
      renderRow={(raw) => {
        const row = raw as unknown as DeviceTableRow
        return (
          <TableRow key={`${row.app}:${row.deviceId}`}>
            <TableCell><Identity row={row} /></TableCell>
            <TableCell><Place row={row} /></TableCell>
            <TableCell><Version row={row} /></TableCell>
            <TableCell className="text-sm">{row.installed ? "Instalada" : "Navegador"}</TableCell>
            <TableCell className="text-sm"><Pending row={row} /></TableCell>
            <TableCell className="text-sm"><LastError row={row} /></TableCell>
            <TableCell className="whitespace-nowrap text-sm" title={formatDateTime(row.lastSeenAt)}>{row.lastSeenLabel}</TableCell>
            <TableCell><StateBadge row={row} /></TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as DeviceTableRow
        return (
          <div key={`${row.app}:${row.deviceId}`} className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="flex items-start justify-between gap-2">
              <Identity row={row} />
              <StateBadge row={row} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-[var(--color-text-subtle)]">{app === "tae" ? "Enlace de acceso" : "Faena"}</dt><dd><Place row={row} /></dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Versión</dt><dd><Version row={row} /></dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Instalación</dt><dd>{row.installed ? "Instalada" : "Navegador"}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Último aviso</dt><dd>{row.lastSeenLabel}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Pendientes</dt><dd><Pending row={row} /></dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Último error</dt><dd><LastError row={row} /></dd></div>
            </dl>
          </div>
        )
      }}
    />
  )
}
