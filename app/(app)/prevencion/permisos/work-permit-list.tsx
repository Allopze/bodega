"use client"

import * as React from "react"
import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableCell, TableRow } from "@/components/ui/table"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { PERMIT_STATUS_LABELS, permitStatusBadgeVariant } from "@/lib/prevention/permits"
import {
  isPermitQuickFilter,
  matchesPermitQuickFilter,
  PERMIT_QUICK_FILTER_LABELS,
  type PermitQuickFilter,
} from "@/lib/prevention/permit-list-filters"
import { formatDateTime } from "@/lib/utils"
import { NewPermitDialog, PermitTypeDialog } from "./permit-dialogs"

interface PermitTypeItem {
  id: string
  code: string
  name: string
  competencyTaskKey: string | null
  requiresIsolation: boolean
  requiresMeasurement: boolean
  requiresJsa: boolean
  requiresCrewAcknowledgement: boolean
  maxDurationHours: number
}

interface WorkerOption {
  id: string
  name: string
  position: string | null
  worksiteId: string
}

type PermitItem = {
  id: string
  code: string
  status: string
  taskDescription: string
  location: string
  plannedStartAt: string
  plannedEndAt: string
  extendedUntilAt: string | null
  suspensionReason: string | null
  worksiteId: string
  worksiteName: string
  typeName: string
  crewCount: number
  acknowledgedCount: number
  openIsolationCount: number
}

interface Props {
  permits: PermitItem[]
  canManage: boolean
  canRequest: boolean
  types: PermitTypeItem[]
  worksites: { id: string; name: string }[]
  workers: WorkerOption[]
  supervisors: { id: string; name: string }[]
}

const COLUMNS = [
  { key: "code", label: "Código / tarea", sortable: true },
  { key: "typeName", label: "Tipo", sortable: true },
  { key: "worksiteName", label: "Faena / lugar", sortable: true },
  { key: "status", label: "Estado", sortable: true },
  { key: "plannedStartAt", label: "Ventana", sortable: true },
  { key: "acknowledgedCount", label: "Acuses", sortable: true, numeric: true },
  { key: "openIsolationCount", label: "LOTO", sortable: true, numeric: true },
]

export function WorkPermitList({ permits, canManage, canRequest, types, worksites, workers, supervisors }: Props) {
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = getFilter("status") || "all"
  const worksite = getFilter("worksite") || "all"
  const quickFilterValue = getFilter("vista")
  const quickFilter: PermitQuickFilter = isPermitQuickFilter(quickFilterValue) ? quickFilterValue : "all"

  const permitWorksites = React.useMemo(() => {
    const map = new Map(permits.map((item) => [item.worksiteId, item.worksiteName]))
    return [...map].map(([id, name]) => ({ id, name }))
  }, [permits])

  const filtered = permits.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (worksite !== "all" && item.worksiteId !== worksite) return false
    return matchesPermitQuickFilter(item, quickFilter)
  })

  const rows = filtered

  const metrics = [
    { id: "active", key: "active" as const, label: "Vigentes en terreno", value: permits.filter((item) => item.status === "active").length, detail: "Trabajo habilitado ahora" },
    { id: "pending", key: "pending" as const, label: "Esperando aprobación", value: permits.filter((item) => item.status === "pending_approval").length, detail: "Requieren revisión" },
    { id: "isolations", key: "isolations" as const, label: "Con energías bloqueadas", value: permits.filter((item) => item.openIsolationCount > 0).length, detail: "LOTO aplicado sin retirar" },
    { id: "suspended", key: "suspended" as const, label: "Suspendidos", value: permits.filter((item) => item.status === "suspended").length, detail: "Detenidos por desviación o vencimiento" },
  ]

  const STATUS_LABELS = PERMIT_STATUS_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (quickFilter !== "all") activeChips.push({
    key: "vista",
    label: "Vista",
    value: quickFilter,
    displayValue: PERMIT_QUICK_FILTER_LABELS[quickFilter],
  })
  if (status !== "all") activeChips.push({ key: "status", label: "Estado", value: status, displayValue: STATUS_LABELS[status] ?? status })
  if (worksite !== "all") {
    const ws = permitWorksites.find((w) => w.id === worksite)
    if (ws) activeChips.push({ key: "worksite", label: "Faena", value: worksite, displayValue: ws.name })
  }
  function handleRemoveChip(key: string) {
    setFilters({ [key]: null })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setFilters({ vista: quickFilter === metric.key ? null : metric.key })}
            aria-pressed={quickFilter === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={handleRemoveChip}
        onClearAll={clearUrlFilters}
        hasActiveFilters={status !== "all" || worksite !== "all" || quickFilter !== "all"}
        actions={
          <>
            {canManage && <PermitTypeDialog />}
            {canRequest && types.length > 0 && worksites.length > 0 && (
              <NewPermitDialog types={types} worksites={worksites} workers={workers} supervisors={supervisors} />
            )}
          </>
        }
      >
        <Select value={status} onValueChange={(value) => setFilters({ status: value === "all" ? null : value })}>
          <SelectTrigger className="w-56" aria-label="Estado del permiso"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(PERMIT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={(value) => setFilters({ worksite: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {permitWorksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>

      <DataTable
        caption="Permisos de trabajo"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["code", "typeName", "taskDescription", "location", "worksiteName"]}
        emptyTitle={permits.length === 0 ? "Aún no hay permisos de trabajo" : "No hay permisos con estos filtros"}
        emptyDescription={permits.length === 0 ? "Un permiso autoriza una tarea crítica sólo cuando su AST está escrito, los controles verificados, las energías aisladas y toda la cuadrilla habilitada." : "Ajusta los filtros o el texto del buscador superior."}
        emptyAction={permits.length > 0 ? <Button type="button" variant="secondary" onClick={() => clearUrlFilters()}>Ver todos</Button> : canRequest && types.length > 0 && worksites.length > 0 ? <NewPermitDialog types={types} worksites={worksites} workers={workers} supervisors={supervisors} /> : canManage ? <PermitTypeDialog /> : undefined}
        renderMobileCard={(item) => {
          return (
            <ResponsiveDataListCard
              title={<Link href={`/prevencion/permisos/${item.id}`} className="font-mono hover:underline">{item.code}</Link>}
              description={item.taskDescription}
              status={<MetaBadge meta={{ label: `${PERMIT_STATUS_LABELS[item.status] ?? item.status}`, variant: permitStatusBadgeVariant(item.status) }} />}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={`/prevencion/permisos/${item.id}`}>Ver permiso</Link></Button>}
            >
              <ResponsiveDataListField label="Tipo">{item.typeName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Faena / lugar">{item.worksiteName} · {item.location}</ResponsiveDataListField>
              <ResponsiveDataListField label="Ventana">
                {formatDateTime(item.plannedStartAt)} hasta {formatDateTime(item.extendedUntilAt ?? item.plannedEndAt)}
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Acuses / cuadrilla">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{item.acknowledgedCount} / {item.crewCount}</span>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="LOTO abierto">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{item.openIsolationCount || "—"}</span>
              </ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(item) => {
          return (
            <TableRow key={item.id}>
              <TableCell>
                <Link href={`/prevencion/permisos/${item.id}`} className="hover:underline">
                  <span className="font-mono text-xs">{item.code}</span>
                  <span className="block max-w-sm text-sm font-medium">{item.taskDescription}</span>
                </Link>
              </TableCell>
              <TableCell className="text-sm">{item.typeName}</TableCell>
              <TableCell className="text-sm">
                {item.worksiteName}
                <span className="block text-xs text-[var(--color-text-subtle)]">{item.location}</span>
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: `${PERMIT_STATUS_LABELS[item.status] ?? item.status}`, variant: permitStatusBadgeVariant(item.status) }} />
                {item.suspensionReason && (
                  <span className="mt-1 block max-w-xs text-xs text-[var(--color-text-subtle)]">{item.suspensionReason}</span>
                )}
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {formatDateTime(item.plannedStartAt)}
                <span className="block text-xs text-[var(--color-text-subtle)]">
                  hasta {formatDateTime(item.extendedUntilAt ?? item.plannedEndAt)}
                  {item.extendedUntilAt && " (extendido)"}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {item.acknowledgedCount} / {item.crewCount}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {item.openIsolationCount > 0 ? item.openIsolationCount : "—"}
              </TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
