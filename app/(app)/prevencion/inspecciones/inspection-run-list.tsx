"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DotsThree, MagnifyingGlass } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Pagination } from "@/components/ui/pagination"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  runStatusBadgeVariant,
} from "@/lib/prevention/inspections"
import { formatDate, formatDateTime } from "@/lib/utils"
import { createInspectionRunAction } from "./actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  inspectionTaskStatusLabel,
  safeNewInspectionDefaults,
  subjectIdsFromRef,
  subjectRefOf,
  type InspectionSubjectOption,
} from "@/lib/prevention/inspection-list-query"

interface TemplateOption {
  id: string
  name: string
  versionLabel: string
  kind: string
}

interface RunItem {
  id: string
  code: string
  status: string
  templateName: string
  templateKind: string
  origin: string
  /** I-18: columna "Origen" decía "Departamento de Prevención" en casi todas las filas; se sustituye por esto. */
  assigneeName: string | null
  subjectLabel: string | null
  worksiteId: string
  worksiteName: string
  executedAt: string | null
  scheduledFor: string | null
  compliancePercent: number | null
  nonConformingCount: number
  openFindings: number
  criticalFindings: number
}

type QuickFilter = "all" | "pending_review" | "open_findings" | "critical" | "overdue"

interface Props {
  runs: RunItem[]
  /** KPIs del universo completo. C-09: derivarlos de la página los volvía mentira pasadas 500 filas. */
  summary: { total: number; pendingReview: number; withOpenFindings: number; withCriticalFindings: number; overdueRuns: number }
  page: number
  pageSize: number
  overdueProgramCount: number
  today: string
  canExecute: boolean
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
}

export function InspectionRunList({ runs, summary, page, pageSize, overdueProgramCount, today, canExecute, templates, worksites, assignees, subjectsByWorksite }: Props) {
  // Filtros client-side en la URL (shareables + sobreviven refresh) vía useUrlFilters.
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = getFilter("estado") || "all"
  // El tipo de instrumento era una ruta aparte (/prevencion/auditorias) con la
  // misma pantalla; ahora es un filtro, que es lo que siempre fue en la tabla.
  const kind = getFilter("tipo") || "all"
  const worksite = getFilter("faena") || "all"
  const quickFilter = (getFilter("vista") || "all") as QuickFilter
  // I-10: responsable + rango de ejecución. Van al sheet "Más filtros" — la
  // barra ya tiene 4 controles y sumar 3 más empeoraría la cabecera móvil (I-12).
  const responsable = getFilter("responsable") || "all"
  const desde = getFilter("desde")
  const hasta = getFilter("hasta")
  const urlSearch = getFilter("q")
  const [searchDraft, setSearchDraft] = React.useState(urlSearch)

  React.useEffect(() => setSearchDraft(urlSearch), [urlSearch])

  React.useEffect(() => {
    const query = searchDraft.trim()
    if (query === urlSearch) return
    const timer = setTimeout(() => setFilters({ q: query || null, pagina: null }), 350)
    return () => clearTimeout(timer)
  }, [searchDraft, urlSearch, setFilters])

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
  const metrics = [
    { id: "pending-review", key: "pending_review" as const, label: "Pendientes de revisión", value: summary.pendingReview, detail: "Requieren a Prevención" },
    { id: "open-findings", key: "open_findings" as const, label: "Con hallazgos abiertos", value: summary.withOpenFindings, detail: "Requieren acción" },
    { id: "critical", key: "critical" as const, label: "Con hallazgo grave", value: summary.withCriticalFindings, detail: "Alto o crítico" },
    // I-31: vencido era el primer criterio de orden y no tenía acceso directo
    // en la bandeja — sólo existía "Programaciones vencidas" (otra pantalla,
    // sobre programas, no sobre ejecuciones ya creadas).
    { id: "overdue", key: "overdue" as const, label: "Vencidas", value: summary.overdueRuns, detail: "Planificadas o en curso" },
  ]

  const totalPages = Math.max(1, Math.ceil(summary.total / pageSize))

  // C-09 movió el filtrado al SQL, así que `runs` ya llega filtrada y quedarse
  // en cero dejó de distinguir "no hay inspecciones" de "no hay con estos
  // filtros": el estado vacío afirmaba siempre lo primero y escondía la salida
  // ("Ver todas"), de modo que buscar algo inexistente era un callejón. El
  // buscador cuenta como filtro aunque viva en la cabecera del shell.
  const search = urlSearch.trim()
  const secondaryActiveCount = [responsable !== "all", Boolean(desde), Boolean(hasta)].filter(Boolean).length
  const isFiltered = status !== "all" || kind !== "all" || worksite !== "all" || quickFilter !== "all" || search !== "" || secondaryActiveCount > 0

  const KIND_LABELS = INSPECTION_KIND_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (status !== "all") activeChips.push({ key: "estado", label: "Estado", value: status, displayValue: inspectionTaskStatusLabel(status) })
  if (kind !== "all") activeChips.push({ key: "tipo", label: "Tipo", value: kind, displayValue: KIND_LABELS[kind] ?? kind })
  if (worksite !== "all") {
    const ws = runWorksites.find((w) => w.id === worksite)
    if (ws) activeChips.push({ key: "faena", label: "Faena", value: worksite, displayValue: ws.name })
  }
  if (search) activeChips.push({ key: "q", label: "Búsqueda", value: search, displayValue: search })
  // I-10: responsable y rango de ejecución, aunque vivan en el sheet "Más
  // filtros" — el estado sigue visible como chip para no esconderlo.
  if (responsable !== "all") {
    const person = assignees.find((item) => item.id === responsable)
    if (person) activeChips.push({ key: "responsable", label: "Responsable", value: responsable, displayValue: person.name })
  }
  if (desde) activeChips.push({ key: "desde", label: "Ejecutada desde", value: desde, displayValue: formatDate(desde) })
  if (hasta) activeChips.push({ key: "hasta", label: "Ejecutada hasta", value: hasta, displayValue: formatDate(hasta) })
  function handleRemoveChip(key: string) {
    setFilters({ [key]: null })
  }
  function clearFilters() {
    setSearchDraft("")
    clearUrlFilters()
  }

  return (
    <div className="space-y-4">
      {/* I-12: en móvil los 5 KPI ocupaban una grilla 2×3 (~170px de alto)
          antes de la primera tarjeta. Una fila con scroll horizontal baja eso
          a una sola fila; desde `lg` vuelve a ser la grilla de siempre. */}
      <div className="flex overflow-x-auto border-y border-[var(--color-border)] lg:grid lg:grid-cols-5 lg:overflow-hidden">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setFilters({ vista: quickFilter === metric.key ? null : metric.key, pagina: null })}
            aria-pressed={quickFilter === metric.key}
            className="w-36 shrink-0 border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)] lg:w-auto"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
        <Link
          href="/prevencion/inspecciones/programacion?vista=vencidas"
          className="w-36 shrink-0 border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] lg:w-auto"
        >
          <span className="text-eyebrow">Programaciones vencidas</span>
          <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{overdueProgramCount}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">Ver y regularizar</span>
        </Link>
      </div>

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={handleRemoveChip}
        onClearAll={clearUrlFilters}
        hasActiveFilters={isFiltered}
        activeCount={secondaryActiveCount}
        overflowFilters={
          <>
            <Field label="Responsable" hint="Quién tiene asignada la ejecución.">
              <Select value={responsable} onValueChange={(value) => setFilters({ responsable: value === "all" ? null : value, pagina: null })}>
                <SelectTrigger aria-label="Responsable"><SelectValue placeholder="Responsable" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los responsables</SelectItem>
                  {assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ejecutada entre" hint="Deja fuera las inspecciones sin ejecutar en el rango.">
              <DateRangePicker
                fromValue={desde}
                toValue={hasta}
                onFromChange={(iso) => setFilters({ desde: iso || null, pagina: null })}
                onToChange={(iso) => setFilters({ hasta: iso || null, pagina: null })}
                fromPlaceholder="Ejecutada desde"
                toPlaceholder="Ejecutada hasta"
              />
            </Field>
          </>
        }
      >
        <div className="relative w-full sm:w-64">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Código, plantilla, sujeto o faena"
            aria-label="Buscar inspecciones"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value, vista: null, pagina: null })}>
          <SelectTrigger className="w-56" aria-label="Estado de la inspección"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {["planned", "in_progress", "completed", "reviewed", "cancelled"].map((value) => <SelectItem key={value} value={value}>{inspectionTaskStatusLabel(value)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value, pagina: null })}>
          <SelectTrigger className="w-52" aria-label="Tipo de instrumento"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
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
          title={isFiltered ? "No hay inspecciones con estos filtros" : "Aún no hay inspecciones ejecutadas"}
          description={isFiltered
            ? "Ajusta los filtros o el texto de búsqueda."
            : "Habilita un instrumento en Plantillas y prográmalo por faena en Programación. Cada incumplimiento genera un hallazgo, y los graves exigen una acción CAPA antes de cerrar."}
          action={isFiltered
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>
            : canExecute && templates.length > 0 && worksites.length > 0
              ? <NewRunDialog templates={templates} worksites={worksites} assignees={assignees} subjectsByWorksite={subjectsByWorksite} />
              : undefined}
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {filtered.map((item) => {
            const overdue = Boolean(item.scheduledFor && item.scheduledFor < today && (item.status === "planned" || item.status === "in_progress"))
            const action = item.status === "planned" ? "Comenzar" : item.status === "in_progress" ? "Continuar" : item.status === "completed" ? "Revisar" : "Ver detalle"
            return (
              <article key={item.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-[var(--color-text-subtle)]">{item.code}</span>
                    <h2 className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{item.templateName}</h2>
                  </div>
                  <Badge variant={runStatusBadgeVariant(item.status)}>{inspectionTaskStatusLabel(item.status)}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="col-span-2">
                    <dt className="text-[var(--color-text-subtle)]">Faena y sujeto</dt>
                    <dd className="mt-0.5 font-medium text-[var(--color-text)]">{item.worksiteName}{item.subjectLabel ? ` · ${item.subjectLabel}` : ""}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Fecha clave</dt>
                    <dd className={overdue ? "mt-0.5 font-semibold text-[var(--color-danger)]" : "mt-0.5 text-[var(--color-text)]"}>
                      {item.executedAt ? formatDateTime(item.executedAt) : item.scheduledFor ? `${overdue ? "Vencida" : "Programada"} · ${formatDate(item.scheduledFor)}` : "Sin fecha"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Resultado</dt>
                    <dd className="mt-0.5 text-[var(--color-text)]">
                      {item.compliancePercent === null ? "Aún no calculable" : `${item.compliancePercent}%`} · {item.openFindings} hallazgo{item.openFindings === 1 ? "" : "s"}
                    </dd>
                  </div>
                </dl>
                <Button asChild className="mt-4 w-full" variant={item.status === "planned" || item.status === "in_progress" ? "primary" : "secondary"}>
                  <Link href={`/prevencion/inspecciones/${item.id}`}>{action}</Link>
                </Button>
              </article>
            )
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / plantilla</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Faena / sujeto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha clave</TableHead>
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
                  <TableCell className="text-sm">{item.assigneeName ?? "Sin asignar"}</TableCell>
                  <TableCell className="text-sm">
                    {item.worksiteName}
                    {item.subjectLabel && <span className="block text-xs text-[var(--color-text-subtle)]">{item.subjectLabel}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={runStatusBadgeVariant(item.status)}>
                      {inspectionTaskStatusLabel(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {item.executedAt
                      ? formatDateTime(item.executedAt)
                      : item.scheduledFor
                        ? <span className={item.scheduledFor < today ? "font-semibold text-[var(--color-danger)]" : undefined}>{item.scheduledFor < today ? "Vencida · " : "Programada · "}{formatDate(item.scheduledFor)}</span>
                        : "Sin fecha"}
                  </TableCell>
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
        </>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          total={summary.total}
          perPage={pageSize}
          onPage={(target) => setFilters({ pagina: target <= 1 ? null : String(target) })}
        />
      )}
    </div>
  )
}

export function InspectionPageActions({
  canCreate,
  canExport,
  templates,
  worksites,
  assignees,
  subjectsByWorksite,
  exportQuery,
}: {
  canCreate: boolean
  canExport: boolean
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  exportQuery: string
}) {
  return (
    <>
      {canCreate ? <NewRunDialog templates={templates} worksites={worksites} assignees={assignees} subjectsByWorksite={subjectsByWorksite} /> : null}
      <div className="hidden items-center gap-1.5 sm:flex">
        <Button asChild variant="secondary"><Link href="/prevencion/inspecciones/plantillas">Plantillas</Link></Button>
        <Button asChild variant="secondary"><Link href="/prevencion/inspecciones/programacion">Programación</Link></Button>
        {canExport ? <Button asChild variant="secondary"><a href={`/api/prevencion/inspecciones/export${exportQuery}`} download>Exportar Excel</a></Button> : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary" size="sm" className="sm:hidden" aria-label="Más acciones de inspecciones">
            <DotsThree size={18} weight="bold" aria-hidden /> Más
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><Link href="/prevencion/inspecciones/plantillas">Administrar plantillas</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/prevencion/inspecciones/programacion">Ver programación</Link></DropdownMenuItem>
          {canExport ? <DropdownMenuItem asChild><a href={`/api/prevencion/inspecciones/export${exportQuery}`} download>Exportar Excel filtrado</a></DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/* ── Alta de inspección ───────────────────────────────────────────────────── */

export function NewRunDialog({ templates, worksites, assignees, subjectsByWorksite }: {
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  /** Inventario de sujetos por faena (función #11). */
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
}) {
  const [open, setOpen] = React.useState(false)
  const defaults = safeNewInspectionDefaults()
  const [templateId, setTemplateId] = React.useState<string>(defaults.templateId)
  const [worksiteId, setWorksiteId] = React.useState<string>(defaults.worksiteId)
  const [assignedToUserId, setAssignedToUserId] = React.useState("_none")
  // Certificación Mutual (Plata/Oro): sin poder marcar 'cphs' aquí, ninguna
  // inspección puede acreditar como originada por el comité paritario (B-05).
  const [origin, setOrigin] = React.useState("prevencion")
  // Función #11: `subjectLabel` era texto libre, así que no había historial por
  // extintor ni forma de alimentar sus alertas de vencimiento. Desde que el
  // padrón de flota también es sujeto, el valor lleva su origen: `source:id`.
  const [subjectRef, setSubjectRef] = React.useState<string>(defaults.subjectRef)
  const operation = useOperation()
  const router = useRouter()

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) return
    setTemplateId("")
    setWorksiteId("")
    setSubjectRef("_none")
    setAssignedToUserId("_none")
    operation.setMessage("")
  }

  function handleWorksiteChange(nextWorksiteId: string) {
    setWorksiteId(nextWorksiteId)
    setSubjectRef("_none")
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!templateId || !worksiteId) {
      operation.setMessage("Selecciona conscientemente la plantilla y la faena antes de crear.")
      return
    }
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
      ...subjectIdsFromRef(subjectRef),
      scheduledFor: scheduledFor || null,
      assignedToUserId: assignedToUserId || null,
    }), (result) => {
      setOpen(false)
      // Se abre la inspección recién creada: el gesto siguiente es ejecutarla,
      // no volver a buscarla en la bandeja (INS-09).
      const runId = result.data?.runId
      if (typeof runId === "string") router.push(`/prevencion/inspecciones/${runId}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild><Button size="sm">Nueva inspección</Button></DialogTrigger>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={submit} className="flex max-h-[min(90dvh,54rem)] flex-col">
          <DialogHeader className="mb-0 shrink-0 border-b border-[var(--color-border)] px-6 pb-4 pt-6">
            <DialogTitle>Nueva inspección</DialogTitle>
            <DialogDescription>Elige explícitamente el instrumento y la faena. Así evitas registrar trabajo en un alcance distinto al que estás visitando.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <Field label="Plantilla" required>
            <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Plantilla"><SelectValue placeholder="Selecciona una plantilla" /></SelectTrigger><SelectContent>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{INSPECTION_KIND_LABELS[item.kind] ?? item.kind} · {item.name} · {item.versionLabel}</SelectItem>)}</SelectContent></Select><input type="hidden" name="templateId" value={templateId} />
          </Field>
          <Field label="Faena" required>
            <Select value={worksiteId} onValueChange={handleWorksiteChange}><SelectTrigger aria-label="Faena de la inspección"><SelectValue placeholder="Selecciona la faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
          </Field>
          <Field label="Origen" hint="Quién origina la inspección — la certificación Mutual distingue las del comité paritario.">
            <Select value={origin} onValueChange={setOrigin}><SelectTrigger aria-label="Origen"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_ORIGIN_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="origin" value={origin} />
          </Field>
          {/* I-25: antes este campo aparecía/desaparecía al elegir faena,
              desplazando el resto del formulario. Ahora ocupa su lugar siempre,
              con un estado explícito mientras no hay faena elegida. */}
          {(!worksiteId || (subjectsByWorksite[worksiteId]?.length ?? 0) > 0) && (
            <Field label="Sujeto inspeccionado" hint={worksiteId ? "Opcional. Un recurso del inventario actualiza su última inspección al completar; un equipo habilita derivar la falla a mantención." : "Selecciona una faena para ver su inventario."}>
              <Select value={subjectRef} onValueChange={setSubjectRef} disabled={!worksiteId}>
                <SelectTrigger aria-label="Sujeto inspeccionado"><SelectValue placeholder={worksiteId ? "Otro / texto libre" : "Selecciona una faena primero"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Otro / texto libre</SelectItem>
                  {(subjectsByWorksite[worksiteId] ?? []).map((subject) => (
                    <SelectItem key={subjectRefOf(subject)} value={subjectRefOf(subject)}>
                      {subject.source === "vehicle" ? "Equipo" : "Recurso"} · {subject.name}
                      {subject.location ? ` · ${subject.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {subjectRef === "_none" ? <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor."><Input name="subjectType" maxLength={120} /></Field>
            <Field label="Identificación del sujeto" hint="Úsalo sólo si el elemento no existe en el inventario."><Input name="subjectLabel" maxLength={300} /></Field>
          </div> : <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">Se usará el sujeto seleccionado del inventario; los campos de texto libre no aplican.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Programada para" hint="Opcional."><DatePicker name="scheduledFor" /></Field>
            <Field label="Asignada a" hint="Vacío = quien la crea.">
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Quien la crea" /></SelectTrigger><SelectContent><SelectItem value="_none">Quien la crea</SelectItem>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="assignedToUserId" value={assignedToUserId === "_none" ? "" : assignedToUserId} />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          </div>
          <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
            <Button type="submit" disabled={operation.pending || !templateId || !worksiteId}>{operation.pending ? "Creando…" : "Crear inspección"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
