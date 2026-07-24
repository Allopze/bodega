"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Siren } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  INCIDENT_EVENT_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentStatusBadgeVariant,
} from "@/lib/prevention/incidents"
import type { IncidentStatus } from "@/lib/services/prevention-incidents"

const OCCURRED_AT_FORMAT = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" })

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

export function IncidentList({ incidents, worksites, counts, canReport, indicatorContext }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = useState("all")
  const [eventType, setEventType] = useState("all")
  const [worksiteId, setWorksiteId] = useState("all")
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all")
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = useMemo(() => incidents.filter((incident) => {
    if (status !== "all" && incident.status !== status) return false
    if (eventType !== "all" && incident.eventType !== eventType) return false
    if (worksiteId !== "all" && incident.worksiteId !== worksiteId) return false
    if (quickFilter === "open" && incident.status === "closed") return false
    if (quickFilter === "overdue" && !incident.hasOverdueNotifications) return false
    if (quickFilter === "fatal" && !incident.isFatalOrSerious) return false
    if (quickFilter === "investigation" && !["immediate_measures", "under_investigation"].includes(incident.status)) return false
    if (!query) return true
    return [incident.code, incident.companyName, incident.worksiteName, incident.location, INCIDENT_EVENT_LABELS[incident.eventType]]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("es-CL").includes(query))
  }), [eventType, incidents, query, quickFilter, status, worksiteId])

  const metrics: Array<{ key: QuickFilter; label: string; value: number; detail: string }> = [
    { key: "open", label: "Abiertos", value: counts.totalOpen, detail: "Requieren gestión" },
    { key: "overdue", label: "Plazos atrasados", value: counts.overdueNotifications, detail: "DIAT/DIEP/autoridad" },
    { key: "fatal", label: "Fatal o grave", value: counts.fatalOrSerious, detail: "Operación suspendida" },
    { key: "investigation", label: "Por investigar", value: counts.pendingInvestigation, detail: "Causa aún abierta" },
  ]

  function clearFilters() {
    setStatus("all")
    setEventType("all")
    setWorksiteId("all")
    setQuickFilter("all")
  }

  return (
    <div className="space-y-4">
      {indicatorContext && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-4 py-3 text-sm"><p><strong>Drill-down canónico:</strong> {indicatorContext}</p><Button asChild size="sm" variant="ghost"><Link href="/prevencion/incidentes">Quitar filtro</Link></Button></div>}
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button key={metric.key} type="button" onClick={() => setQuickFilter((current) => current === metric.key ? "all" : metric.key)} aria-pressed={quickFilter === metric.key} className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]">
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={(value) => { setStatus(value); setQuickFilter("all") }}>
          <SelectTrigger className="w-52" aria-label="Estado del incidente"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{Object.entries(INCIDENT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={eventType} onValueChange={setEventType}>
          <SelectTrigger className="w-64" aria-label="Tipo de evento"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los eventos</SelectItem>{Object.entries(INCIDENT_EVENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
        </Select>
        {(status !== "all" || eventType !== "all" || worksiteId !== "all" || quickFilter !== "all") && <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Siren size={22} />}
          title={incidents.length === 0 ? "Aún no hay incidentes canónicos" : "No hay incidentes con estos filtros"}
          description={incidents.length === 0 ? "Registra aquí los eventos ocurridos en tus faenas: reporte, triage, investigación y CAPA quedan trazados desde el primer registro." : "Ajusta filtros o el buscador superior."}
          action={incidents.length === 0 && canReport ? <Button asChild><Link href="/prevencion/incidentes/reportar">Reportar incidente</Link></Button> : <Button type="button" variant="secondary" onClick={clearFilters}>Ver todos</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader><TableRow><TableHead>Código / evento</TableHead><TableHead>Faena y empresa</TableHead><TableHead>Ocurrencia</TableHead><TableHead>Gravedad</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.map((incident) => (
              <TableRow key={incident.id}>
                <TableCell><Link href={`/prevencion/incidentes/${incident.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">{incident.code}</Link><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{INCIDENT_EVENT_LABELS[incident.eventType] ?? incident.eventType}</p></TableCell>
                <TableCell><p className="font-medium">{incident.worksiteName}</p><p className="text-xs text-[var(--color-text-subtle)]">{incident.companyName}</p></TableCell>
                <TableCell><p className="tabular-nums">{OCCURRED_AT_FORMAT.format(new Date(incident.occurredAt))}</p><p className="max-w-56 truncate text-xs text-[var(--color-text-subtle)]">{incident.location}</p></TableCell>
                <TableCell><Badge variant={incident.isFatalOrSerious ? "danger" : "default"}>{INCIDENT_SEVERITY_LABELS[incident.actualSeverity] ?? incident.actualSeverity}</Badge><p className="mt-1 text-xs text-[var(--color-text-subtle)]">Potencial {INCIDENT_SEVERITY_LABELS[incident.potentialSeverity] ?? incident.potentialSeverity}</p></TableCell>
                <TableCell><Badge variant={incidentStatusBadgeVariant(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status}</Badge></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
