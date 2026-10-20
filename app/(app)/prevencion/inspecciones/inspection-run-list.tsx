"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CaretRight, MagnifyingGlass, Warning } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Pagination } from "@/components/ui/pagination"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  complianceUnavailableReason,
  inspectionRunIsOverdue,
  runStatusBadgeVariant,
} from "@/lib/prevention/inspections"
import { cn, formatDate, formatDateTime } from "@/lib/utils"
import { createInspectionRunAction } from "./actions"
import { InspectionTemplateSelect } from "./template-select"
import { SubjectSelectField } from "./_components/subject-select-field"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  AssigneeSelectOptions,
  findWorksiteSuggestedAssignee,
  type InspectionAssigneeOption,
} from "./assignee-picker"
import {
  NO_SUBJECT,
  inspectionTaskStatusLabel,
  safeNewInspectionDefaults,
  subjectIdsFromRef,
  templateRequiresContainer,
  type InspectionSubjectOption,
} from "@/lib/prevention/inspection-list-query"

interface TemplateOption {
  id: string
  name: string
  versionLabel: string
  kind: string
  /* Necesario acá y no sólo en el servicio: la plantilla de contenedores exige
   * sujeto del catálogo, así que el diálogo no debe siquiera ofrecer el texto
   * libre que era la vía de entrada de las etiquetas escritas a mano. */
  sourceDefinitionCode: string | null
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
  /**
   * Con permiso de revisión el tile «Pendientes de revisión» cuenta lo que
   * puede revisar quien mira (excluye lo que él ejecutó); sin él son las que
   * esperan a Prevención. Sólo cambia el texto del tile: el conteo lo decide el
   * servidor con el mismo predicado que la lista (`pendingReviewCondition`).
   */
  canReview: boolean
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: InspectionAssigneeOption[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  /**
   * Avisos que la pantalla del servidor quiere ver sobre la barra de filtros (hoy,
   * el resumen de actividades programadas del PDTP). Es un componente de
   * servidor, así que llega ya armado como nodo: este componente de cliente no
   * puede importarlo. Antes iba al pie, bajo hasta 50 filas y la paginación.
   */
  activities?: React.ReactNode
}

/**
 * Hallazgos abiertos de una ejecución, con los graves aparte. `compact`: «1 abierto (1 grave)»;
 * si no, «1 abierto · 1 grave». En cero dice «Sin hallazgos», no «Sin hallazgos abiertos»: esa
 * frase es la del tile en cero y repetirla en cada fila la volvía ruido (y dos nodos con el mismo texto).
 */
function findingsLabel(open: number, critical: number, style: "compact" | "inline"): string {
  if (open === 0) return "Sin hallazgos"
  const opened = `${open} ${open === 1 ? "abierto" : "abiertos"}`
  if (critical === 0) return opened
  const severe = `${critical} ${critical === 1 ? "grave" : "graves"}`
  return style === "compact" ? `${opened} (${severe})` : `${opened} · ${severe}`
}

/**
 * «Fecha clave» de una ejecución: cuándo se ejecutó o, si no, para cuándo estaba programada.
 *
 * `stacked` (la tabla): bajo `xl` la columna es angosta y el navegador partía «Programada · 25-/08-2026»
 * en el guion de la fecha. El salto va entre el rótulo y la fecha; desde `xl`, donde cabe, se oculta. El
 * texto sigue siendo uno solo (el `<br>` no aporta texto), así que se lee y se busca igual.
 */
function KeyDate({ item, today, stacked = false }: { item: RunItem; today: string; stacked?: boolean }) {
  if (item.executedAt) return <>{formatDateTime(item.executedAt)}</>
  if (!item.scheduledFor) return <>Sin fecha</>
  const overdue = inspectionRunIsOverdue(item, today)
  return (
    <span className={overdue ? "font-semibold text-[var(--color-danger-ink)]" : undefined}>
      {overdue ? "Vencida · " : "Programada · "}{stacked && <br className="xl:hidden" />}{formatDate(item.scheduledFor)}
    </span>
  )
}

/** Cumplimiento de una ejecución, o por qué no se puede calcular. */
function ComplianceValue({ item }: { item: RunItem }) {
  if (item.compliancePercent === null) {
    // En sans y sin cortes: en mono y con el ancho que le dejaba la columna se
    // partía en dos líneas («No / calculable»).
    return <span title={complianceUnavailableReason(item.status)} className="whitespace-nowrap">No calculable</span>
  }
  return <span className="font-mono tabular-nums">{item.compliancePercent}%</span>
}

function runAction(status: string): string {
  if (status === "planned") return "Comenzar"
  if (status === "in_progress") return "Continuar"
  if (status === "completed") return "Revisar"
  return "Ver detalle"
}

export function InspectionRunList({ runs, summary, page, pageSize, overdueProgramCount, today, canExecute, canReview, templates, worksites, assignees, subjectsByWorksite, activities }: Props) {
  // Filtros client-side en la URL (shareables + sobreviven refresh) vía useUrlFilters.
  const { getFilter, setFilters, clearFilters: clearUrlFilters, isPending } = useUrlFilters()
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
  // del usuario (que la pantalla carga para cualquiera con `view`, P1-10), más
  // la faena de las filas presentes — una faena dada de baja ya no está en el
  // alcance activo, pero sus ejecuciones siguen listadas.
  const runWorksites = React.useMemo(() => {
    const map = new Map<string, string>(worksites.map((item) => [item.id, item.name]))
    for (const item of runs) if (!map.has(item.worksiteId)) map.set(item.worksiteId, item.worksiteName)
    return [...map].map(([id, name]) => ({ id, name }))
  }, [worksites, runs])

  // C-09: el filtrado vive en el SQL. `runs` ya llega filtrada y paginada, y
  // los KPIs vienen de `summary` — derivarlos de la página los volvía mentira
  // en cuanto había más de una.
  const filtered = runs

  // C-09 movió el filtrado al SQL, así que `runs` ya llega filtrada y quedarse
  // en cero dejó de distinguir "no hay inspecciones" de "no hay con estos
  // filtros": el estado vacío afirmaba siempre lo primero y escondía la salida
  // ("Ver todas"), de modo que buscar algo inexistente era un callejón. El
  // buscador cuenta como filtro aunque viva en la cabecera del shell.
  const search = urlSearch.trim()
  const secondaryActiveCount = [responsable !== "all", Boolean(desde), Boolean(hasta)].filter(Boolean).length
  const isFiltered = status !== "all" || kind !== "all" || worksite !== "all" || quickFilter !== "all" || search !== "" || secondaryActiveCount > 0
  // P1-9: los KPI acotan el universo con estos filtros (tipo, faena, búsqueda,
  // responsable y rango) y NO con el estado ni la vista, que eligen un
  // subconjunto de él. Cuando alguno de estos está activo, un cero no significa
  // "todo al día" sino "nada con estos filtros", y decirlo con el texto del
  // estado bueno afirmaría algo que el tile no sabe.
  const otherFiltersActive = kind !== "all" || worksite !== "all" || search !== "" || secondaryActiveCount > 0

  // A1: cuatro tiles, y los cuatro filtran esta misma lista. "Programaciones
  // vencidas" salió de la fila porque navegaba a otra ruta con la misma
  // apariencia de filtro; ahora es el aviso de abajo, visible sólo cuando hay
  // algo que regularizar.
  //
  // `emptyDetail` existe porque un `0` con el subtítulo de siempre ("Requieren
  // acción") no distinguía "todo al día" de "no hay datos": en cero el tile
  // afirma el estado bueno y deja de ser clicable (un clic sólo podía llevar a
  // una lista vacía).
  const metrics = [
    {
      id: "pending-review", key: "pending_review" as const, label: "Pendientes de revisión", value: summary.pendingReview,
      detail: canReview ? "Puedes revisarlas tú" : "Esperan a Prevención",
      emptyDetail: canReview ? "Nada esperando tu revisión" : "Nada esperando revisión",
    },
    { id: "open-findings", key: "open_findings" as const, label: "Con hallazgos abiertos", value: summary.withOpenFindings, detail: "Requieren acción", emptyDetail: "Sin hallazgos abiertos" },
    { id: "critical", key: "critical" as const, label: "Con hallazgo grave", value: summary.withCriticalFindings, detail: "Alto o crítico", emptyDetail: "Ninguno alto ni crítico" },
    // I-31: vencido era el primer criterio de orden y no tenía acceso directo
    // en la bandeja — sólo existía "Programaciones vencidas" (otra pantalla,
    // sobre programas, no sobre ejecuciones ya creadas).
    { id: "overdue", key: "overdue" as const, label: "Vencidas", value: summary.overdueRuns, detail: "Planificadas o en curso", emptyDetail: "Ninguna fuera de plazo" },
  ]

  const totalPages = Math.max(1, Math.ceil(summary.total / pageSize))

  const KIND_LABELS = INSPECTION_KIND_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (status !== "all") activeChips.push({ key: "estado", label: "Estado", value: status, displayValue: inspectionTaskStatusLabel(status) })
  // La vista rápida también es un filtro activo: sin chip, `?vista=critical`
  // dejaba la lista acotada sin ningún rótulo que lo dijera ni cómo quitarlo.
  const activeView = metrics.find((metric) => metric.key === quickFilter)
  if (activeView) activeChips.push({ key: "vista", label: "Vista", value: quickFilter, displayValue: activeView.label })
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
    // Quitar un filtro cambia el total: seguir en la página 3 de una lista que
    // ahora tiene dos caería en una página vacía. Y el borrador del buscador se
    // vacía a la vez que la URL, o el debounce lo volvería a escribir.
    if (key === "q") setSearchDraft("")
    // NO `useUrlFilters({ pageKey: "pagina" })`: `setFilters({ pagina: N })` de
    // `Pagination` pondría la clave y el hook la borraría enseguida, dejando la
    // lista sin poder avanzar de página. La página se reinicia explícita, aquí.
    setFilters({ [key]: null, pagina: null })
  }
  function clearFilters() {
    setSearchDraft("")
    clearUrlFilters()
  }

  return (
    <div className="space-y-4">
      {/* Dos por fila hasta `lg` y cuatro desde ahí, sin región con scroll: la
          tira horizontal escondía el cuarto tile en el teléfono y sumaba una
          región enfocable que axe marcaba. Las líneas entre tiles son el `gap`
          sobre el fondo del contenedor, así no hay que decidir qué tile lleva
          qué borde en cada ancho. */}
      <div className="grid grid-cols-2 gap-px border-y border-[var(--color-border)] bg-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const active = quickFilter === metric.key
          // En cero no hay subconjunto al que llevar. Sigue siendo pulsable si
          // es el filtro activo: si no, el usuario quedaría encerrado en una
          // vista vacía sin poder apagarla desde el mismo control.
          const inert = metric.value === 0 && !active
          // Tercera línea del tile. Activo: lo dice con palabras, porque el
          // fondo tintado solo no lo distingue para quien no percibe el color
          // (WCAG 1.4.1). En cero: "todo bien" sólo si no hay otros filtros;
          // con ellos el cero es relativo a lo filtrado.
          const caption = active
            ? "Filtrando la lista"
            : inert
              ? (otherFiltersActive ? "Ninguna con estos filtros" : metric.emptyDetail)
              : metric.detail
          return (
            <button
              key={metric.id}
              type="button"
              disabled={inert}
              // A5: una dimensión, un control. El tile elige la vista y suelta
              // el estado (si no, `estado=planned&vista=pending_review` era una
              // intersección siempre vacía) y la página (el total cambia).
              onClick={() => setFilters({ vista: active ? null : metric.key, estado: null, pagina: null })}
              aria-pressed={active}
              // Señal no cromática del activo: borde inferior de 2 px, dibujado
              // como sombra interior para no sumar alto a la fila al activarse.
              className="bg-[var(--color-surface)] px-4 py-3 text-left enabled:hover:bg-[var(--color-surface-2)] disabled:cursor-default aria-pressed:bg-[var(--color-primary-tint)] aria-pressed:shadow-[inset_0_-2px_0_0_var(--color-primary)]"
            >
              {/* Hasta `xl` el rótulo más largo se parte en dos líneas y bajaba
                  su cifra respecto de las otras tres: reservar las dos líneas
                  las deja alineadas. Desde `xl` cabe en una y no hace falta. */}
              <span className="line-clamp-2 min-h-[2lh] text-eyebrow xl:min-h-0">{metric.label}</span>
              <span className={inert
                ? "mt-1 block font-mono text-xl font-semibold tabular-nums text-[var(--color-text-subtle)]"
                : "mt-1 block font-mono text-xl font-semibold tabular-nums"}>{metric.value}</span>
              <span className={active
                ? "block text-xs font-medium text-[var(--color-primary-ink)]"
                : "block text-xs text-[var(--color-text-subtle)]"}>{caption}</span>
            </button>
          )
        })}
      </div>

      {/* Programaciones vencidas son programas, no ejecuciones: viven en otra
          pantalla y no filtran esta lista. Como aviso accionable dice lo mismo
          sin disfrazarse de KPI, y desaparece cuando no hay nada que hacer. */}
      {overdueProgramCount > 0 && (
        <Callout tone="warning" role="none" icon={<Warning size={18} weight="fill" />}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">
              {overdueProgramCount} {overdueProgramCount === 1 ? "programación vencida" : "programaciones vencidas"}
            </span>
            <span>no han generado su ejecución.</span>
            <Link href="/prevencion/inspecciones/programacion?vista=vencidas" className="inline-flex min-h-11 items-center font-medium underline underline-offset-2 sm:min-h-0">
              Ver y regularizar
            </Link>
          </p>
        </Callout>
      )}

      {activities}

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
        {/* Bajo `xl` la búsqueda ocupa su propia fila: a 1024 px compartía la
            primera con los selects y empujaba «Más filtros» a una segunda fila
            solo. Los selects van en un contenedor de ancho fijo porque la barra
            fuerza `w-auto` a sus botones directos y los dejaba a ancho del
            contenido, distinto en cada carga según la opción elegida. La altura
            del input es la de los selects (36 px; el input solo mide 34). */}
        <div className="relative w-full xl:w-64">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Código, plantilla, sujeto o faena"
            aria-label="Buscar inspecciones"
            className="pl-9 sm:h-9"
          />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value, vista: null, pagina: null })}>
            <SelectTrigger aria-label="Estado de la inspección"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {["planned", "in_progress", "completed", "reviewed", "cancelled"].map((value) => <SelectItem key={value} value={value}>{inspectionTaskStatusLabel(value)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value, pagina: null })}>
            <SelectTrigger aria-label="Tipo de instrumento"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value, pagina: null })}>
            <SelectTrigger aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las faenas</SelectItem>
              {runWorksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FilterToolbar>

      {/* `aria-busy` mientras la URL nueva se resuelve en el servidor: la lista
          vieja sigue en pantalla y, sin esto, nada dice que ya se pidió otra. */}
      <div aria-busy={isPending || undefined} className={cn(isPending && "opacity-60")}>
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
            {filtered.map((item) => (
              <ResponsiveDataListCard
                key={item.id}
                title={
                  <Link href={`/prevencion/inspecciones/${item.id}`} className="inline-flex min-h-11 items-center font-mono hover:underline md:min-h-0">
                    {item.code}
                  </Link>
                }
                description={<span className="text-sm text-[var(--color-text)]">{item.templateName}</span>}
                status={<MetaBadge meta={{ label: inspectionTaskStatusLabel(item.status), variant: runStatusBadgeVariant(item.status) }} />}
                actions={
                  <Button asChild className="w-full" variant={item.status === "planned" || item.status === "in_progress" ? "primary" : "secondary"}>
                    <Link href={`/prevencion/inspecciones/${item.id}`}>{runAction(item.status)}</Link>
                  </Button>
                }
              >
                <ResponsiveDataListField label="Faena y sujeto" className="col-span-2">
                  <span className="font-medium text-[var(--color-text)]">{item.worksiteName}{item.subjectLabel ? ` · ${item.subjectLabel}` : ""}</span>
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Responsable">{item.assigneeName ?? "Sin asignar"}</ResponsiveDataListField>
                <ResponsiveDataListField label="Tipo">{INSPECTION_KIND_LABELS[item.templateKind] ?? item.templateKind}</ResponsiveDataListField>
                <ResponsiveDataListField label="Fecha clave">
                  <span className="text-[var(--color-text)]"><KeyDate item={item} today={today} /></span>
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Resultado">
                  <span className="text-[var(--color-text)]"><ComplianceValue item={item} /></span>
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Hallazgos" className="col-span-2">
                  <span className={item.criticalFindings > 0 ? "font-medium text-[var(--color-danger-ink)]" : undefined}>
                    {findingsLabel(item.openFindings, item.criticalFindings, "inline")}
                  </span>
                </ResponsiveDataListField>
              </ResponsiveDataListCard>
            ))}
          </div>
          {/* La tabla va en `TableRoot`, que ya trae el borde, el recorte y la
              región enfocable con su nombre: antes era un `div` propio con
              `overflow-x-auto` y sin nombre. Hasta `xl` el responsable baja a
              sublínea de «Faena / sujeto» y el tipo a sublínea de «Inspección»,
              para que «Estado» y «Resultado» no queden tras un scroll horizontal. */}
          <TableRoot aria-label="Inspecciones" className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3">Inspección</TableHead>
                  <TableHead className="px-3">Faena / sujeto</TableHead>
                  <TableHead className="hidden px-3 xl:table-cell">Responsable</TableHead>
                  {/* `w-px` en «Estado» y «Resultado»: la columna mide lo que su contenido
                      (que no se parte) y el resto del ancho es para los textos que sí pueden
                      envolverse. Sin eso la tabla repartía el ancho a ojo y partía
                      «1 abierto (1 / grave)» a 1024 px mientras «Estado» sobraba. */}
                  <TableHead className="w-px px-3">Estado</TableHead>
                  <TableHead className="px-3">Fecha clave</TableHead>
                  <TableHead className="w-px px-3" title="Cumplimiento sobre los ítems evaluables (sin los «no aplica») y hallazgos abiertos; entre paréntesis, los graves">Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-3 align-top">
                      <Link href={`/prevencion/inspecciones/${item.id}`} className="hover:underline">
                        <span className="font-mono text-xs">{item.code}</span>
                        <span className="block text-sm font-medium">{item.templateName}</span>
                      </Link>
                      <span className="block text-xs text-[var(--color-text-subtle)]">{INSPECTION_KIND_LABELS[item.templateKind] ?? item.templateKind}</span>
                    </TableCell>
                    <TableCell className="px-3 align-top text-sm">
                      <span className="block">{item.worksiteName}</span>
                      {item.subjectLabel && <span className="block text-xs text-[var(--color-text-subtle)]">{item.subjectLabel}</span>}
                      <span className="block text-xs text-[var(--color-text-subtle)] xl:hidden">Resp.: {item.assigneeName ?? "Sin asignar"}</span>
                    </TableCell>
                    <TableCell className="hidden px-3 align-top text-sm xl:table-cell">{item.assigneeName ?? "Sin asignar"}</TableCell>
                    <TableCell className="whitespace-nowrap px-3 align-top">
                      <MetaBadge meta={{ label: inspectionTaskStatusLabel(item.status), variant: runStatusBadgeVariant(item.status) }} />
                    </TableCell>
                    <TableCell className="px-3 align-top text-sm tabular-nums">
                      <KeyDate item={item} today={today} stacked />
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 align-top text-sm">
                      <ComplianceValue item={item} />
                      <span
                        title="Hallazgos abiertos; entre paréntesis, los graves"
                        className={cn("block text-xs", item.criticalFindings > 0 ? "font-medium text-[var(--color-danger-ink)]" : "text-[var(--color-text-subtle)]")}
                      >
                        {findingsLabel(item.openFindings, item.criticalFindings, "compact")}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
          </>
        )}
      </div>

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
  initialTemplateId,
  initialWorksiteId,
  initialOpen,
}: {
  canCreate: boolean
  canExport: boolean
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  exportQuery: string
  initialTemplateId?: string
  initialWorksiteId?: string
  initialOpen?: boolean
}) {
  return (
    <>
      {canCreate ? <NewRunDialog
        templates={templates}
        worksites={worksites}
        assignees={assignees}
        subjectsByWorksite={subjectsByWorksite}
        initialTemplateId={initialTemplateId}
        initialWorksiteId={initialWorksiteId}
        initialOpen={initialOpen}
      /> : null}
      {canExport
        ? <Button asChild variant="secondary"><a href={`/api/prevencion/inspecciones/export${exportQuery}`} download>Exportar Excel</a></Button>
        : null}
    </>
  )
}

/* ── Alta de inspección ───────────────────────────────────────────────────── */

interface NewRunProps {
  templates: TemplateOption[]
  worksites: { id: string; name: string }[]
  assignees: InspectionAssigneeOption[]
  /** Inventario de sujetos por faena (función #11). */
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  initialTemplateId?: string
  initialWorksiteId?: string
  initialOpen?: boolean
}

/** Valor del selector de responsable cuando no se eligió a nadie (lo fija `findWorksiteSuggestedAssignee`). */
const NO_ASSIGNEE = "_none"

/** Los campos del formulario que el servidor puede señalar por nombre. */
const NEW_RUN_FIELDS = ["templateId", "worksiteId", "subjectLabel", "scheduledFor", "assignedToUserId"] as const

export function NewRunDialog(props: NewRunProps) {
  const [open, setOpen] = React.useState(Boolean(props.initialOpen))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nueva inspección</Button></DialogTrigger>
      <DialogContent className="overflow-hidden p-0">
        {/* El formulario es un componente aparte y no vive en este: el contenido
            del diálogo se desmonta al cerrarlo, y con él los errores por campo
            y lo escrito. Así reabrirlo parte limpio sin resetear a mano cada
            estado (el aviso del intento anterior reaparecía sobre el formulario
            vacío). */}
        <NewRunForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function NewRunForm({ templates, worksites, assignees, subjectsByWorksite, initialTemplateId, initialWorksiteId, initialOpen, onDone }: NewRunProps & { onDone: () => void }) {
  const validInitialTemplateId = initialTemplateId && templates.some((item) => item.id === initialTemplateId) ? initialTemplateId : ""
  const validInitialWorksiteId = initialWorksiteId && worksites.some((item) => item.id === initialWorksiteId) ? initialWorksiteId : ""
  const defaults = safeNewInspectionDefaults()
  const initialEffectiveWorksiteId = validInitialWorksiteId || defaults.worksiteId
  const [templateId, setTemplateId] = React.useState<string>(validInitialTemplateId || defaults.templateId)
  const [worksiteId, setWorksiteId] = React.useState<string>(initialEffectiveWorksiteId)
  const [assignedToUserId, setAssignedToUserId] = React.useState<string>(() =>
    findWorksiteSuggestedAssignee(assignees, initialEffectiveWorksiteId)
  )
  // Certificación Mutual (Plata/Oro): sin poder marcar 'cphs' aquí, ninguna
  // inspección puede acreditar como originada por el comité paritario (B-05).
  const [origin, setOrigin] = React.useState("prevencion")
  // Función #11: `subjectLabel` era texto libre, así que no había historial por
  // extintor ni forma de alimentar sus alertas de vencimiento. Desde que el
  // padrón de flota también es sujeto, el valor lleva su origen: `source:id`.
  const [subjectRef, setSubjectRef] = React.useState<string>(defaults.subjectRef)
  const operation = useOperation()
  const router = useRouter()

  function handleWorksiteChange(nextWorksiteId: string) {
    setWorksiteId(nextWorksiteId)
    setSubjectRef(NO_SUBJECT)
    setAssignedToUserId(findWorksiteSuggestedAssignee(assignees, nextWorksiteId))
  }

  const template = templates.find((item) => item.id === templateId)
  const requiresContainer = templateRequiresContainer(template?.sourceDefinitionCode)
  const worksiteSubjects = subjectsByWorksite[worksiteId] ?? []
  const missingContainer = requiresContainer && !subjectRef.startsWith("container:")

  function handleTemplateChange(nextTemplateId: string) {
    setTemplateId(nextTemplateId)
    // Cambiar de plantilla puede invalidar el sujeto elegido (un extintor no
    // sirve para la inspección de contenedores).
    setSubjectRef(NO_SUBJECT)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // El botón ya viene deshabilitado sin plantilla, faena o contenedor: esto
    // sólo cubre un envío que no pasó por él.
    if (!templateId || !worksiteId || missingContainer) return
    const form = new FormData(event.currentTarget)
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const subjectLabel = String(form.get("subjectLabel") ?? "").trim()
    const scheduledFor = String(form.get("scheduledFor") ?? "").trim()
    operation.run(() => createInspectionRunAction({
      templateId,
      worksiteId,
      origin,
      subjectType: subjectType || null,
      subjectLabel: subjectLabel || null,
      ...subjectIdsFromRef(subjectRef),
      scheduledFor: scheduledFor || null,
      assignedToUserId: assignedToUserId === NO_ASSIGNEE ? null : assignedToUserId || null,
    }), (result) => {
      onDone()
      // Se abre la inspección recién creada: el gesto siguiente es ejecutarla,
      // no volver a buscarla en la bandeja (INS-09).
      const runId = result.data?.runId
      if (typeof runId === "string") router.push(`/prevencion/inspecciones/${runId}`)
    })
  }

  // El aviso general sólo cuando el servidor no señaló ninguno de los campos que
  // se ven: si lo hizo, el mensaje ya está bajo su campo y repetirlo arriba lo
  // leería dos veces.
  const fieldErrorShown = NEW_RUN_FIELDS.some((name) => Boolean(operation.fieldError(name)))

  return (
    <form onSubmit={submit} className="flex max-h-[min(90dvh,54rem)] flex-col">
      <DialogHeader className="mb-0 shrink-0 border-b border-[var(--color-border)] px-6 pb-4 pt-6">
        <DialogTitle>Nueva inspección</DialogTitle>
        <DialogDescription>{initialOpen
          ? "La actividad programada dejó elegidos el instrumento y la faena. Confirma los datos antes de crear."
          : "Elige el instrumento y la faena donde se hará."}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <Field label="Plantilla" required error={operation.fieldError("templateId")}>
          <InspectionTemplateSelect templates={templates} value={templateId} onValueChange={handleTemplateChange} />
        </Field>
        <Field label="Faena" required error={operation.fieldError("worksiteId")}>
          <Select value={worksiteId} onValueChange={handleWorksiteChange}>
            <SelectTrigger aria-label="Faena de la inspección"><SelectValue placeholder="Selecciona la faena" /></SelectTrigger>
            <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {/* I-25: antes este campo aparecía/desaparecía al elegir faena,
            desplazando el resto del formulario. Ahora ocupa su lugar siempre,
            con un estado explícito mientras no hay faena elegida o su
            inventario está vacío. */}
        <SubjectSelectField
          worksiteId={worksiteId}
          subjects={worksiteSubjects}
          requiresContainer={requiresContainer}
          value={subjectRef}
          onValueChange={setSubjectRef}
          noneLabel="Otro / texto libre"
          hint={!worksiteId
            ? "Elige primero la faena."
            : requiresContainer
              ? "Obligatorio: se inspecciona por contenedor del catálogo."
              : "Opcional. Un equipo del inventario permite derivar una falla a mantención."}
        />
        {/* El texto libre sólo existe con «Otro»: con un sujeto del inventario o
            sin faena elegida eran dos campos que no aplicaban y que había que
            leer para descubrirlo. */}
        {worksiteId && !requiresContainer && subjectRef === NO_SUBJECT && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Ej.: extintor, camión."><Input name="subjectType" maxLength={120} /></Field>
            <Field label="Identificación del sujeto" hint="Si no está en el inventario." error={operation.fieldError("subjectLabel")}><Input name="subjectLabel" maxLength={300} /></Field>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Programada para" hint="Opcional." error={operation.fieldError("scheduledFor")}><DatePicker name="scheduledFor" /></Field>
          <Field label="Asignada a" hint="Vacío: quien la crea." error={operation.fieldError("assignedToUserId")}>
            <Select value={assignedToUserId} onValueChange={setAssignedToUserId}>
              <SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Quien la crea" /></SelectTrigger>
              <SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={worksiteId} noneLabel="Quien la crea" /></SelectContent>
            </Select>
          </Field>
        </div>
        {/* «Origen» casi siempre es el valor por defecto: plegado deja de
            competir con lo que sí hay que decidir, y el rótulo dice cuál está
            vigente sin abrirlo. */}
        <details className="group rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <CaretRight size={14} aria-hidden className="shrink-0 group-open:rotate-90" />
            Más opciones · Origen: {INSPECTION_ORIGIN_LABELS[origin] ?? origin}
          </summary>
          <div className="border-t border-[var(--color-border)] px-3 py-3">
            <Field label="Origen" hint="Quién origina la inspección; la certificación Mutual distingue al comité paritario.">
              <Select value={origin} onValueChange={setOrigin}>
                <SelectTrigger aria-label="Origen"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(INSPECTION_ORIGIN_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </details>
        {operation.message && !fieldErrorShown && (
          <Callout tone="danger" role="alert">{operation.message}</Callout>
        )}
      </div>
      <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
        <Button type="submit" loading={operation.pending} disabled={!templateId || !worksiteId || missingContainer}>Crear inspección</Button>
      </DialogFooter>
    </form>
  )
}
