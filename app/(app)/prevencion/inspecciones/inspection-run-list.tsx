"use client"

import * as React from "react"
import Link from "next/link"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
  runStatusBadgeVariant,
} from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"
import { createInspectionRunAction } from "./actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"

interface TemplateOption {
  id: string
  name: string
  versionLabel: string
}

interface RunItem {
  id: string
  code: string
  status: string
  templateName: string
  templateKind: string
  origin: string
  subjectLabel: string | null
  worksiteId: string
  worksiteName: string
  executedAt: string | null
  compliancePercent: number | null
  nonConformingCount: number
  openFindings: number
  criticalFindings: number
}

type QuickFilter = "all" | "pending_review" | "open_findings" | "critical"

interface Props {
  runs: RunItem[]
  /** KPIs del universo completo. C-09: derivarlos de la página los volvía mentira pasadas 500 filas. */
  summary: { total: number; pendingReview: number; withOpenFindings: number; withCriticalFindings: number }
  page: number
  pageSize: number
  overdueProgramCount: number
  canExecute: boolean
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  subjectsByWorksite: Record<string, { id: string; name: string; kind: string; location: string }[]>
}

export function InspectionRunList({ runs, summary, page, pageSize, overdueProgramCount, canExecute, templates, worksites, assignees, subjectsByWorksite }: Props) {
  const { searchQuery } = useSafeShellHeader()
  // Filtros client-side en la URL (shareables + sobreviven refresh) vía useUrlFilters.
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = getFilter("estado") || "all"
  const worksite = getFilter("faena") || "all"
  const quickFilter = (getFilter("vista") || "all") as QuickFilter

  // Con el filtrado en el servidor, derivar las faenas de las filas visibles
  // dejaría el selector vacío en cuanto se filtrara por una: se usa el alcance
  // del usuario, más la faena de las filas presentes para quien no puede
  // ejecutar (a ese `worksites` le llega vacío).
  const runWorksites = React.useMemo(() => {
    const map = new Map<string, string>(worksites.map((item) => [item.id, item.name]))
    for (const item of runs) if (!map.has(item.worksiteId)) map.set(item.worksiteId, item.worksiteName)
    return [...map].map(([id, name]) => ({ id, name }))
  }, [worksites, runs])

  // C-09: el filtrado vive en el SQL. `runs` ya llega filtrada y paginada, y
  // los KPIs vienen de `summary` — derivarlos de la página los volvía mentira
  // en cuanto había más de una.
  const filtered = runs
  // El buscador de la cabecera viaja a la URL para que llegue al servidor; sin
  // esto sólo buscaría dentro de la página visible.
  React.useEffect(() => {
    const query = searchQuery.trim()
    const current = getFilter("q") ?? ""
    if (query === current) return
    const timer = setTimeout(() => setFilters({ q: query || null, pagina: null }), 350)
    return () => clearTimeout(timer)
  }, [searchQuery, getFilter, setFilters])

  const metrics = [
    { id: "pending-review", key: "pending_review" as const, label: "Esperando revisión", value: summary.pendingReview, detail: "Ejecutadas sin cerrar" },
    { id: "open-findings", key: "open_findings" as const, label: "Con hallazgos abiertos", value: summary.withOpenFindings, detail: "Requieren acción" },
    { id: "critical", key: "critical" as const, label: "Con hallazgo grave", value: summary.withCriticalFindings, detail: "Alto o crítico" },
    { id: "overdue", key: "all" as const, label: "Programaciones vencidas", value: overdueProgramCount, detail: "Inspección no ejecutada a tiempo" },
  ]

  const totalPages = Math.max(1, Math.ceil(summary.total / pageSize))

  const STATUS_LABELS = INSPECTION_RUN_STATUS_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (status !== "all") activeChips.push({ key: "estado", label: "Estado", value: status, displayValue: STATUS_LABELS[status] ?? status })
  if (worksite !== "all") {
    const ws = runWorksites.find((w) => w.id === worksite)
    if (ws) activeChips.push({ key: "faena", label: "Faena", value: worksite, displayValue: ws.name })
  }
  function handleRemoveChip(key: string) {
    setFilters({ [key]: null })
  }
  function clearFilters() {
    clearUrlFilters()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setFilters({ vista: quickFilter === metric.key ? null : metric.key, pagina: null })}
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
        actions={canExecute && templates.length > 0 && worksites.length > 0 ? (
          <NewRunDialog templates={templates} worksites={worksites} assignees={assignees} subjectsByWorksite={subjectsByWorksite} />
        ) : undefined}
      >
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value, vista: null, pagina: null })}>
          <SelectTrigger className="w-56" aria-label="Estado de la inspección"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(INSPECTION_RUN_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value, pagina: null })}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {runWorksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlass size={20} />}
          title={runs.length === 0 ? "Aún no hay inspecciones ejecutadas" : "No hay inspecciones con estos filtros"}
          description={runs.length === 0
            ? "Incorpora una plantilla del catálogo, apruébala y prográmala por faena. Cada incumplimiento genera un hallazgo, y los graves exigen una acción CAPA antes de cerrar."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={runs.length > 0
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>
            : canExecute && templates.length > 0 && worksites.length > 0
              ? <NewRunDialog templates={templates} worksites={worksites} assignees={assignees} subjectsByWorksite={subjectsByWorksite} />
              : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / plantilla</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Faena / sujeto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ejecutada</TableHead>
                <TableHead className="text-right" title="Porcentaje sobre ítems evaluables; excluye los no aplica">Cumplimiento</TableHead>
                <TableHead className="text-right" title="Hallazgos abiertos y, entre paréntesis, los graves">Hallazgos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/prevencion/inspecciones/${item.id}`} className="hover:underline">
                      <span className="font-mono text-xs">{item.code}</span>
                      <span className="block text-sm font-medium">{item.templateName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{INSPECTION_KIND_LABELS[item.templateKind] ?? item.templateKind}</TableCell>
                  <TableCell className="text-sm">{INSPECTION_ORIGIN_LABELS[item.origin] ?? item.origin}</TableCell>
                  <TableCell className="text-sm">
                    {item.worksiteName}
                    {item.subjectLabel && <span className="block text-xs text-[var(--color-text-subtle)]">{item.subjectLabel}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={runStatusBadgeVariant(item.status)}>
                      {INSPECTION_RUN_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{item.executedAt ? formatDateTime(item.executedAt) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.compliancePercent === null ? "No calculable" : `${item.compliancePercent}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.openFindings}{item.criticalFindings > 0 && ` (${item.criticalFindings})`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-[var(--color-text-subtle)]">
            Página {page} de {totalPages} · {summary.total} inspecciones
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setFilters({ pagina: page - 1 <= 1 ? null : String(page - 1) })}
            >
              Anterior
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setFilters({ pagina: String(page + 1) })}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Alta de inspección ───────────────────────────────────────────────────── */

function NewRunDialog({ templates, worksites, assignees, subjectsByWorksite }: {
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  /** Inventario de sujetos por faena (función #11). */
  subjectsByWorksite: Record<string, { id: string; name: string; kind: string; location: string }[]>
}) {
  const [open, setOpen] = React.useState(false)
  const [templateId, setTemplateId] = React.useState(templates[0]?.id ?? "")
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [assignedToUserId, setAssignedToUserId] = React.useState("_none")
  // Certificación Mutual (Plata/Oro): sin poder marcar 'cphs' aquí, ninguna
  // inspección puede acreditar como originada por el comité paritario (B-05).
  const [origin, setOrigin] = React.useState("prevencion")
  // Función #11: `subjectLabel` era texto libre, así que no había historial por
  // extintor ni forma de alimentar sus alertas de vencimiento.
  const [subjectResourceId, setSubjectResourceId] = React.useState("_none")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const subjectLabel = String(form.get("subjectLabel") ?? "").trim()
    const scheduledFor = String(form.get("scheduledFor") ?? "").trim()
    const assignedToUserId = String(form.get("assignedToUserId") ?? "").trim()
    operation.run(() => createInspectionRunAction({
      templateId: form.get("templateId"),
      worksiteId: form.get("worksiteId"),
      origin: form.get("origin"),
      subjectType: subjectType || null,
      subjectLabel: subjectLabel || null,
      subjectResourceId: subjectResourceId === "_none" ? null : subjectResourceId,
      scheduledFor: scheduledFor || null,
      assignedToUserId: assignedToUserId || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nueva inspección</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva inspección</DialogTitle>
            <DialogDescription>Sólo puede ejecutarse una plantilla aprobada. Las respuestas se registran después, desde el detalle.</DialogDescription>
          </DialogHeader>
          <Field label="Plantilla">
            <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="templateId" value={templateId} />
          </Field>
          <Field label="Faena">
            <Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
          </Field>
          <Field label="Origen" hint="Quién origina la inspección — la certificación Mutual distingue las del comité paritario.">
            <Select value={origin} onValueChange={setOrigin}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_ORIGIN_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="origin" value={origin} />
          </Field>
          {(subjectsByWorksite[worksiteId]?.length ?? 0) > 0 && (
            <Field label="Sujeto del inventario" hint="Opcional. Al completar, actualiza su última inspección.">
              <Select value={subjectResourceId} onValueChange={setSubjectResourceId}>
                <SelectTrigger><SelectValue placeholder="Otro / texto libre" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Otro / texto libre</SelectItem>
                  {(subjectsByWorksite[worksiteId] ?? []).map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>{subject.name} · {subject.location}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor."><Input name="subjectType" maxLength={120} /></Field>
            <Field label="Identificación del sujeto" hint="Opcional si eliges un sujeto del inventario."><Input name="subjectLabel" maxLength={300} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Programada para" hint="Opcional."><DatePicker name="scheduledFor" /></Field>
            <Field label="Asignada a" hint="Vacío = quien la crea.">
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger><SelectValue placeholder="Quien la crea" /></SelectTrigger><SelectContent><SelectItem value="_none">Quien la crea</SelectItem>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="assignedToUserId" value={assignedToUserId === "_none" ? "" : assignedToUserId} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
