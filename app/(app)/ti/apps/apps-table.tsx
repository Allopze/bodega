"use client"

import Link from "next/link"
import { ArrowSquareOut } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { TableRow, TableCell } from "@/components/ui/table"
import { MetaBadge } from "@/components/states/state-badge"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { NAV_ICONS } from "@/components/layout/nav-icons"
import { formatDateRelative, formatDateTime } from "@/lib/utils"
import type { IntegrationStatus } from "@/lib/apps/metrics"
import { INTEGRATION_STATUS_META } from "./status"

export interface AppRow {
  id: string
  label: string
  href: string
  iconName: string
  areaLabel: string
  areaOrder: number
  activityNote: string | null
  enabled: boolean
  usersWithAccess: number
  activeUsers: number
  movements: number
  visits: number
  trend: number[]
  lastActivityAt: string | null
  idle: boolean
  integrationStatus: IntegrationStatus | "none"
  integrationCount: number
  integrationProblems: number
}

const COLUMNS = [
  { key: "app", label: "App", sortable: true, sortValue: (row: AppRow) => row.areaOrder },
  { key: "usersWithAccess", label: "Con acceso", sortable: true, numeric: true, width: "w-28", sortValue: (row: AppRow) => row.usersWithAccess },
  { key: "activeUsers", label: "Activos 30 d", sortable: true, numeric: true, width: "w-28", sortValue: (row: AppRow) => row.activeUsers },
  { key: "visits", label: "Visitas 30 d", sortable: true, numeric: true, width: "w-28", sortValue: (row: AppRow) => row.visits },
  { key: "movements", label: "Movimientos 30 d", sortable: true, numeric: true, width: "w-48", sortValue: (row: AppRow) => row.movements },
  { key: "lastActivity", label: "Última actividad", sortable: true, width: "w-40", sortValue: (row: AppRow) => row.lastActivityAt ?? "" },
  { key: "integrations", label: "Integraciones", sortable: true, width: "w-40", sortValue: (row: AppRow) => row.integrationProblems },
  { key: "open", label: "", width: "w-24" },
]

function AppIcon({ iconName }: { iconName: string }) {
  const Icon = NAV_ICONS[iconName] ?? NAV_ICONS.GridFour!
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-primary)]">
      <Icon size={18} aria-hidden />
    </span>
  )
}

function AppName({ row }: { row: AppRow }) {
  return (
    <div className="flex items-center gap-3">
      <AppIcon iconName={row.iconName} />
      <div className="min-w-0">
        <Link href={`/ti/apps/${row.id}`} className="font-medium text-[var(--color-primary-ink)] hover:underline">
          {row.label}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-subtle)]">
          <span>{row.areaLabel}</span>
          {!row.enabled && <MetaBadge size="sm" meta={{ label: "Desactivada", variant: "neutral" }} />}
        </div>
      </div>
    </div>
  )
}

function LastActivity({ row }: { row: AppRow }) {
  if (!row.lastActivityAt && row.activityNote) return <span className="text-xs text-[var(--color-text-subtle)]">{row.activityNote}</span>
  if (!row.lastActivityAt) return <span className="text-xs text-[var(--color-signal-ink)]">Más de un año</span>
  return (
    <span className={row.idle ? "text-[var(--color-signal-ink)]" : undefined} title={formatDateTime(row.lastActivityAt)}>
      {formatDateRelative(row.lastActivityAt)}
    </span>
  )
}

function Integrations({ row }: { row: AppRow }) {
  if (row.integrationStatus === "none") return <span className="text-xs text-[var(--color-text-subtle)]">No tiene</span>
  const meta = INTEGRATION_STATUS_META[row.integrationStatus]
  const detail = row.integrationProblems > 0
    ? `${row.integrationProblems} de ${row.integrationCount} con problemas`
    : `${row.integrationCount} ${row.integrationCount === 1 ? "tarea" : "tareas"}`
  return (
    <div className="flex flex-col items-start gap-0.5">
      <MetaBadge meta={meta} title={meta.hint} />
      <span className="text-xs text-[var(--color-text-subtle)]">{detail}</span>
    </div>
  )
}

function Movements({ row }: { row: AppRow }) {
  if (row.activityNote) return <span className="font-mono tabular-nums text-[var(--color-text-subtle)]">—</span>
  return (
    <div className="flex items-center justify-end gap-3">
      <MiniSparkline data={row.trend} className="h-6 w-16" />
      <span className="font-mono tabular-nums">{row.movements.toLocaleString("es-CL")}</span>
    </div>
  )
}

function OpenApp({ row }: { row: AppRow }) {
  if (!row.enabled) return null
  return (
    <Link
      href={row.href}
      className="inline-flex items-center gap-1 text-sm text-[var(--color-primary-ink)] hover:underline"
      aria-label={`Abrir ${row.label}`}
    >
      Abrir <ArrowSquareOut size={14} aria-hidden />
    </Link>
  )
}

export function AppsTable({ rows, filtered }: { rows: AppRow[]; filtered: boolean }) {
  return (
    <DataTable
      caption="Apps de la plataforma"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["label", "areaLabel"]}
      pageSize={50}
      emptyTitle={filtered ? "Ninguna app cumple este filtro" : "No hay apps registradas"}
      emptyDescription={filtered ? "Todas las apps están bien en este aspecto." : "Las apps salen del registro de módulos de la plataforma."}
      emptyAction={filtered ? <Link href="/ti/apps" replace scroll={false} className="text-sm text-[var(--color-primary-ink)] hover:underline">Ver todas las apps</Link> : undefined}
      renderRow={(raw) => {
        const row = raw as unknown as AppRow
        return (
          <TableRow key={row.id}>
            <TableCell><AppName row={row} /></TableCell>
            <TableCell className="w-28 text-right font-mono tabular-nums">{row.usersWithAccess}</TableCell>
            <TableCell className="w-28 text-right font-mono tabular-nums">{row.activeUsers}</TableCell>
            <TableCell className="w-28 text-right font-mono tabular-nums">{row.visits.toLocaleString("es-CL")}</TableCell>
            <TableCell className="w-48 text-right" title={row.activityNote ?? undefined}><Movements row={row} /></TableCell>
            <TableCell className="w-40 text-sm"><LastActivity row={row} /></TableCell>
            <TableCell className="w-40"><Integrations row={row} /></TableCell>
            <TableCell className="w-24 text-right"><OpenApp row={row} /></TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as AppRow
        return (
          <div key={row.id} className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="flex items-start justify-between gap-2">
              <AppName row={row} />
              <OpenApp row={row} />
            </div>
            <dl className="grid grid-cols-4 gap-2 text-xs">
              <div><dt className="text-[var(--color-text-subtle)]">Con acceso</dt><dd className="font-mono tabular-nums">{row.usersWithAccess}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Activos 30 d</dt><dd className="font-mono tabular-nums">{row.activeUsers}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Visitas</dt><dd className="font-mono tabular-nums">{row.visits.toLocaleString("es-CL")}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Movimientos</dt><dd className="font-mono tabular-nums">{row.activityNote ? "—" : row.movements.toLocaleString("es-CL")}</dd></div>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <LastActivity row={row} />
              <Integrations row={row} />
            </div>
          </div>
        )
      }}
    />
  )
}
