"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StageTabs } from "@/components/ui/stage-tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatDateTime } from "@/lib/utils"
import {
  INCIDENT_EVENT_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentStatusBadgeVariant,
} from "@/lib/prevention/incidents"
import {
  buildIncidentStatusTabs,
  parseIncidentCondition,
  parseIncidentStatusView,
  type IncidentCondition,
  type IncidentStatusCounts,
} from "@/lib/prevention/incident-list-filters"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"

type IncidentListItem = {
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
  /** Condiciones que cruzan los estados; cuentan con el estado elegido (lo que la lista mostraría al activarlas). */
  counts: { overdueNotifications: number; fatalOrSerious: number }
  /** Contadores de las pestañas de estado: con los demás filtros aplicados y sin el de estado. */
  statusCounts: IncidentStatusCounts
  canReport: boolean
  indicatorContext?: string
}

const COLUMNS = [
  { key: "code", label: "Código / evento", sortable: true },
  { key: "worksiteName", label: "Faena y empresa", sortable: true },
  { key: "occurredAt", label: "Ocurrencia", sortable: true },
  { key: "actualSeverity", label: "Gravedad", sortable: true },
  { key: "status", label: "Estado", sortable: true },
]

export function IncidentList({ incidents, worksites, counts, statusCounts, canReport, indicatorContext }: Props) {
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  // Regla A5: el estado son las pestañas (`?status=`) y las tarjetas son condiciones que
  // cruzan los estados (`?quick=overdue|fatal`, que sigue en la URL para que el tablero
  // pueda aterrizar aquí). La página resuelve todos los filtros en el servidor: `incidents`
  // llega ya recortado y la tabla sólo suma el buscador de la barra superior.
  const status = parseIncidentStatusView(getFilter("status"))
  const condition = parseIncidentCondition(getFilter("quick"))
  const eventType = getFilter("eventType") || "all"
  const worksiteId = getFilter("worksiteId") || "all"
  // «Sin filtros» se decide por la URL, no por el resultado: una lista vacía por un
  // filtro no es «aún no hay incidentes».
  const hayFiltroActivo = Boolean(status || condition || eventType !== "all" || worksiteId !== "all"
    || ["year", "monthFrom", "monthTo", "indicator"].some((key) => getFilter(key)))
  const sinDatos = incidents.length === 0 && !hayFiltroActivo
  const rows = incidents.map((incident) => ({
    ...incident,
    eventTypeLabel: INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType,
  }))

  const metrics: Array<{ key: IncidentCondition; label: string; value: number; detail: string }> = [
    { key: "overdue", label: "Plazos atrasados", value: counts.overdueNotifications, detail: "DIAT/DIEP/autoridad" },
    { key: "fatal", label: "Fatal o grave", value: counts.fatalOrSerious, detail: "Operación suspendida" },
  ]

  const EVENT_LABELS = INCIDENT_EVENT_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
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
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)]">
        {metrics.map((metric) => (
          <button key={metric.key} type="button" onClick={() => setFilters({ quick: condition === metric.key ? null : metric.key })} aria-pressed={condition === metric.key} className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]">
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <StageTabs tabs={buildIncidentStatusTabs(statusCounts)} ariaLabel="Estado de los incidentes" param="status" />

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={handleRemoveChip}
        // El estado no es un filtro (son las pestañas): limpiar no cambia de pestaña.
        onClearAll={() => clearUrlFilters(["status"])}
        hasActiveFilters={eventType !== "all" || worksiteId !== "all" || Boolean(condition)}
      >
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
        emptyTitle={sinDatos ? "Aún no hay incidentes canónicos" : "No hay incidentes con estos filtros"}
        emptyDescription={sinDatos ? "Registra aquí los eventos ocurridos en tus faenas: reporte, triage, investigación y CAPA quedan trazados desde el primer registro." : "Ajusta filtros o el buscador superior."}
        emptyAction={sinDatos && canReport ? <Button asChild><Link href="/prevencion/incidentes/reportar">Reportar incidente</Link></Button> : <Button type="button" variant="secondary" onClick={() => clearUrlFilters()}>Ver todos</Button>}
        renderMobileCard={(incident) => {
          return (
            <ResponsiveDataListCard
              title={<Link href={`/prevencion/incidentes/${incident.id}`} className="hover:underline">{incident.code}</Link>}
              description={INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType}
              status={<MetaBadge meta={{ label: `${INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}`, variant: incidentStatusBadgeVariant(incident.status) }} />}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={`/prevencion/incidentes/${incident.id}`}>Ver incidente</Link></Button>}
            >
              <ResponsiveDataListField label="Faena">{incident.worksiteName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Empresa">{incident.companyName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Ocurrió">
                {formatDateTime(incident.occurredAt)}
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Gravedad">
                <MetaBadge meta={{ label: `${INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}`, variant: incident.isFatalOrSerious ? "danger" : "default" }} />
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Ubicación" className="col-span-2">{incident.location}</ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(incident) => {
          return (
            <TableRow key={incident.id}>
              <TableCell><Link href={`/prevencion/incidentes/${incident.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">{incident.code}</Link><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType}</p></TableCell>
              <TableCell><p className="font-medium">{incident.worksiteName}</p><p className="text-xs text-[var(--color-text-subtle)]">{incident.companyName}</p></TableCell>
              <TableCell><p className="tabular-nums">{formatDateTime(incident.occurredAt)}</p><p className="max-w-56 truncate text-xs text-[var(--color-text-subtle)]">{incident.location}</p></TableCell>
              <TableCell><MetaBadge meta={{ label: `${INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}`, variant: incident.isFatalOrSerious ? "danger" : "default" }} /><p className="mt-1 text-xs text-[var(--color-text-subtle)]">Potencial {INCIDENT_SEVERITY_LABELS[incident.potentialSeverity] ?? incident.potentialSeverity}</p></TableCell>
              <TableCell><MetaBadge meta={{ label: `${INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}`, variant: incidentStatusBadgeVariant(incident.status) }} /></TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
