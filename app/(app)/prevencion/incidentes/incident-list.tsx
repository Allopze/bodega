"use client"

import Link from "next/link"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableCell, TableRow } from "@/components/ui/table"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatDateTime } from "@/lib/utils"
import {
  INCIDENT_EVENT_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentStatusBadgeVariant,
} from "@/lib/prevention/incidents"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"

interface IncidentListItem {
  id: string
  code: string
  worksiteId: string
  worksiteName: string
  companyName: string
  eventType: string
  status: string
  occurredAt: string
  knownAt: string
  location: string
  actualSeverity: string
  potentialSeverity: string
  isFatalOrSerious: boolean
  hasOverdueNotifications: boolean
  source: string
  version: number
}

interface Props {
  incidents: IncidentListItem[]
  worksites: Array<{ id: string; name: string }>
  counts: { totalOpen: number; overdueNotifications: number; fatalOrSerious: number; pendingInvestigation: number }
  canReport: boolean
  indicatorContext?: string
}

type QuickFilter = "all" | "open" | "overdue" | "fatal" | "investigation"

const COLUMNS = [
  { key: "code", label: "Código / evento", sortable: true },
  { key: "worksiteName", label: "Faena y empresa", sortable: true },
  { key: "occurredAt", label: "Ocurrencia", sortable: true },
  { key: "actualSeverity", label: "Gravedad", sortable: true },
  { key: "status", label: "Estado", sortable: true },
]

export function IncidentList({ incidents, worksites, counts, canReport, indicatorContext }: Props) {
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = getFilter("status") || "all"
  const eventType = getFilter("eventType") || "all"
  const worksiteId = getFilter("worksiteId") || "all"
  // §3.3: el quick filter vive en la URL (`quick=open`) y no en estado local, para
  // que un KPI del dashboard pueda aterrizar en la lista ya filtrada y la cifra
  // tenga un camino hacia el detalle que la reproduce.
  const quickFilter = (getFilter("quick") || "all") as QuickFilter
  const filtered = incidents.filter((incident) => {
    if (status !== "all" && incident.status !== status) return false
    if (eventType !== "all" && incident.eventType !== eventType) return false
    if (worksiteId !== "all" && incident.worksiteId !== worksiteId) return false
    if (quickFilter === "open" && incident.status === "closed") return false
    if (quickFilter === "overdue" && !incident.hasOverdueNotifications) return false
    if (quickFilter === "fatal" && !incident.isFatalOrSerious) return false
    if (quickFilter === "investigation" && !["immediate_measures", "under_investigation"].includes(incident.status)) return false
    return true
  })

  const rows = filtered.map((incident) => ({
    ...incident,
    eventTypeLabel: INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType,
  })) as unknown as Record<string, unknown>[]

  const metrics: Array<{ key: QuickFilter; label: string; value: number; detail: string }> = [
    { key: "open", label: "Abiertos", value: counts.totalOpen, detail: "Requieren gestión" },
    { key: "overdue", label: "Plazos atrasados", value: counts.overdueNotifications, detail: "DIAT/DIEP/autoridad" },
    { key: "fatal", label: "Fatal o grave", value: counts.fatalOrSerious, detail: "Operación suspendida" },
    { key: "investigation", label: "Por investigar", value: counts.pendingInvestigation, detail: "Causa aún abierta" },
  ]

  const STATUS_LABELS = INCIDENT_STATUS_LABELS as Record<string, string>
  const EVENT_LABELS = INCIDENT_EVENT_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (status !== "all") activeChips.push({ key: "status", label: "Estado", value: status, displayValue: STATUS_LABELS[status] ?? status })
  if (eventType !== "all") activeChips.push({ key: "eventType", label: "Tipo de evento", value: eventType, displayValue: EVENT_LABELS[eventType] ?? eventType })
  if (worksiteId !== "all") {
    const ws = worksites.find((w) => w.id === worksiteId)
    if (ws) activeChips.push({ key: "worksiteId", label: "Faena", value: worksiteId, displayValue: ws.name })
  }
  function handleRemoveChip(key: string) {
    setFilters({ [key]: null })
  }

  return (
    <div className="space-y-4">
      {indicatorContext && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-4 py-3 text-sm"><p><strong>Drill-down canónico:</strong> {indicatorContext}</p><Button asChild size="sm" variant="ghost"><Link href="/prevencion/incidentes">Quitar filtro</Link></Button></div>}
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button key={metric.key} type="button" onClick={() => setFilters({ quick: quickFilter === metric.key ? null : metric.key })} aria-pressed={quickFilter === metric.key} className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]">
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
        hasActiveFilters={status !== "all" || eventType !== "all" || worksiteId !== "all" || quickFilter !== "all"}
      >
        <Select value={status} onValueChange={(value) => { setFilters({ status: value === "all" ? null : value, quick: null }) }}>
          <SelectTrigger className="w-52" aria-label="Estado del incidente"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{Object.entries(INCIDENT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={eventType} onValueChange={(value) => setFilters({ eventType: value === "all" ? null : value })}>
          <SelectTrigger className="w-64" aria-label="Tipo de evento"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los eventos</SelectItem>{Object.entries(INCIDENT_EVENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={worksiteId} onValueChange={(value) => setFilters({ worksiteId: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
        </Select>
      </FilterToolbar>

      <DataTable
        caption="Incidentes y denuncias"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["code", "companyName", "worksiteName", "location", "eventTypeLabel"]}
        emptyTitle={incidents.length === 0 ? "Aún no hay incidentes canónicos" : "No hay incidentes con estos filtros"}
        emptyDescription={incidents.length === 0 ? "Registra aquí los eventos ocurridos en tus faenas: reporte, triage, investigación y CAPA quedan trazados desde el primer registro." : "Ajusta filtros o el buscador superior."}
        emptyAction={incidents.length === 0 && canReport ? <Button asChild><Link href="/prevencion/incidentes/reportar">Reportar incidente</Link></Button> : <Button type="button" variant="secondary" onClick={() => clearUrlFilters()}>Ver todos</Button>}
        renderMobileCard={(row) => {
          const incident = row as unknown as IncidentListItem
          return (
            <ResponsiveDataListCard
              title={<Link href={`/prevencion/incidentes/${incident.id}`} className="hover:underline">{incident.code}</Link>}
              description={INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType}
              status={<Badge variant={incidentStatusBadgeVariant(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}</Badge>}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={`/prevencion/incidentes/${incident.id}`}>Ver incidente</Link></Button>}
            >
              <ResponsiveDataListField label="Faena">{incident.worksiteName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Empresa">{incident.companyName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Ocurrió">
                {formatDateTime(incident.occurredAt)}
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Gravedad">
                <Badge variant={incident.isFatalOrSerious ? "danger" : "default"}>{INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}</Badge>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Ubicación" className="col-span-2">{incident.location}</ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(row) => {
          const incident = row as unknown as IncidentListItem
          return (
            <TableRow key={incident.id}>
              <TableCell><Link href={`/prevencion/incidentes/${incident.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">{incident.code}</Link><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType}</p></TableCell>
              <TableCell><p className="font-medium">{incident.worksiteName}</p><p className="text-xs text-[var(--color-text-subtle)]">{incident.companyName}</p></TableCell>
              <TableCell><p className="tabular-nums">{formatDateTime(incident.occurredAt)}</p><p className="max-w-56 truncate text-xs text-[var(--color-text-subtle)]">{incident.location}</p></TableCell>
              <TableCell><Badge variant={incident.isFatalOrSerious ? "danger" : "default"}>{INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}</Badge><p className="mt-1 text-xs text-[var(--color-text-subtle)]">Potencial {INCIDENT_SEVERITY_LABELS[incident.potentialSeverity] ?? incident.potentialSeverity}</p></TableCell>
              <TableCell><Badge variant={incidentStatusBadgeVariant(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}</Badge></TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
