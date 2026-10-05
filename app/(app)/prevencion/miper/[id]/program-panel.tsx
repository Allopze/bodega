"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { CaretDown, CaretRight, ClipboardText } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ProgramProgress } from "@/lib/prevention/miper/progress"
import type { MiperEntrySnapshot, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { hrefToActivity, hrefToFicha, hrefToMatrix, hrefToTab, PROGRAM_FILTER_KEYS } from "@/lib/prevention/miper/workspace-url"
import type { ProgramHeaderView, ProgramOccurrenceView, ProgramWorkspace } from "@/lib/services/miper/program-queries"
import { formatDate, todayInChile } from "@/lib/utils"
import { saveProgramHeaderAction } from "../actions"
import { GenerateActionsDialog } from "./generate-actions-dialog"
import { OccurrenceDialog } from "./occurrence-dialog"
import { ProgramActionCard, nextPendingOccurrence, ratioLabel } from "./program-action-card"
import { PROGRAM_SCHEDULE_OPTIONS, ProgramActionDialog, RetireActionDialog } from "./program-action-dialog"
import { ProgramActivityView } from "./program-activity-view"
import { useWorkspaceFilterNavigation } from "./use-workspace-filter-navigation"
import { WorkspaceLink } from "./workspace-nav"

export { ActionProgress } from "./program-action-card"

const ESTADO_OPTIONS = [
  { value: "todas", label: "Todas las actividades" },
  { value: "activas", label: "Sólo activas" },
  { value: "retiradas", label: "Sólo retiradas" },
  { value: "vencidas", label: "Con ejecuciones vencidas" },
  { value: "incumplidas", label: "Con ejecuciones incumplidas" },
]

const FRECUENCIA_OPTIONS = [{ value: "todas", label: "Todas las frecuencias" }, ...PROGRAM_SCHEDULE_OPTIONS]

/**
 * Pestaña «Programa» del espacio de trabajo MIPER: el Programa de Trabajo
 * Preventivo RE-04.1 (§7).
 *
 * Todo se pinta desde `program` (props): `page.tsx` lo carga en paralelo con la
 * matriz y cada acción revalida la ruta, así que tras guardar llega un
 * `program` nuevo y nada se recarga a mano. NO se copia a un `useState`: Atrás
 * restaura payloads de renders anteriores y una copia quedaría vieja. Los
 * filtros viven en la URL y se cambian sin ida al servidor
 * (`useWorkspaceFilterNavigation`); `?actividad=` abre el detalle de una
 * actividad (`ProgramActivityView`).
 */
/** Acciones de lista: el workspace las coloca en PageHeader. */
export function ProgramPageActions({ matrixId, mode, users, program }: {
  matrixId: string
  mode: WorkspaceMode
  users: Array<{ id: string; name: string }>
  program: ProgramWorkspace
}) {
  const [dialog, setDialog] = React.useState<"generate" | "create" | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  if (!mode.canEdit) return null
  const activeActions = program.actions.filter((action) => action.status === "active")
  /* Regla A3: varios flujos de alta → un solo botón que pregunta cuál. Y una sola
   * acción primaria por vista (la del encabezado es «Enviar a revisión»): antes
   * había dos botones rellenos de 30 px compitiendo con los de 34 px de al lado. */
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="secondary" aria-label="Agregar actividades"><span>Agregar<span className="hidden xl:inline"> actividades</span></span><CaretDown aria-hidden className="ml-1 size-3.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("generate")}>Generar desde las medidas…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("create")}>Agregar una a mano…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <GenerateActionsDialog matrixId={matrixId} users={users} actions={activeActions}
        open={dialog === "generate"} onOpenChange={(open) => setDialog(open ? "generate" : null)} returnFocusRef={triggerRef} />
      <ProgramActionDialog matrixId={matrixId} processes={program.processes} users={users}
        defaultLocationLabel={program.program?.worksiteName ?? null}
        open={dialog === "create"} onOpenChange={(open) => setDialog(open ? "create" : null)} returnFocusRef={triggerRef} />
    </>
  )
}

export function ProgramPanel({
  matrixId,
  mode,
  userId,
  users,
  program,
  rows,
  header,
  activityId,
}: {
  matrixId: string
  mode: WorkspaceMode
  userId: string
  /** Personas de la faena: responsables y encargado del formulario. */
  users: Array<{ id: string; name: string }>
  program: ProgramWorkspace
  rows: readonly MiperEntrySnapshot[]
  /** Encabezado de la ficha (sólo lectura aquí): de ahí salen la empresa, el RUT y el representante. */
  header: MiperSnapshot["header"]
  activityId: string | null
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { setFilter, clearFilters } = useWorkspaceFilterNavigation(PROGRAM_FILTER_KEYS)
  const [registerTarget, setRegisterTarget] = React.useState<{ occurrence: ProgramOccurrenceView } | null>(null)
  const [retireTargetId, setRetireTargetId] = React.useState<string | null>(null)
  const [headerOpen, setHeaderOpen] = React.useState(false)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const today = todayInChile()

  const urlSearch = searchParams.get("q") ?? ""
  const [search, setSearch] = React.useState(urlSearch)
  React.useEffect(() => { setSearch(urlSearch) }, [urlSearch])
  React.useEffect(() => {
    if (search === urlSearch) return
    const timer = setTimeout(() => setFilter("q", search.trim() || null), 300)
    return () => clearTimeout(timer)
  }, [search, urlSearch, setFilter])

  const actions = program.actions
  const programHeader = program.program
  const query = urlSearch.trim().toLowerCase()
  const estado = searchParams.get("estado") ?? "todas"
  const frecuencia = searchParams.get("frecuencia") ?? "todas"

  if (activityId) {
    const action = actions.find((candidate) => candidate.id === activityId) ?? null
    if (action && programHeader) {
      return (
        <ProgramActivityView
          matrixId={matrixId}
          programId={programHeader.id}
          action={action}
          mode={mode}
          userId={userId}
          users={users}
          rows={rows}
          processes={program.processes}
        />
      )
    }
    return (
      <EmptyState
        title="Esta actividad ya no existe"
        description="Puede que se haya retirado o que el programa haya cambiado. Vuelve a la lista para ver las actividades vigentes."
        action={<Button asChild><WorkspaceLink href={hrefToTab(pathname, searchParams, "programa")} restoreScroll>Volver al programa</WorkspaceLink></Button>}
      />
    )
  }

  const filtered = actions.filter((action) => {
    if (estado === "activas" && action.status !== "active") return false
    if (estado === "retiradas" && action.status !== "retired") return false
    if (estado === "vencidas" && action.progress.overdue === 0) return false
    if (estado === "incumplidas" && action.progress.failed === 0) return false
    if (frecuencia !== "todas" && action.scheduleKind !== frecuencia) return false
    if (!query) return true
    return [
      action.description, action.processName, action.responsibleName, action.locationLabel,
      `actividad ${action.actionNumber}`, String(action.actionNumber),
      ...action.controls.map((control) => `fila ${control.rowNumber} ${control.description}`),
    ].filter(Boolean).join(" ").toLowerCase().includes(query)
  }).sort((a, b) => {
    const aNext = a.status === "active" ? nextPendingOccurrence(a) : null
    const bNext = b.status === "active" ? nextPendingOccurrence(b) : null
    if (aNext && bNext) return aNext.dueOn.localeCompare(bNext.dueOn) || a.actionNumber - b.actionNumber
    if (aNext) return -1
    if (bNext) return 1
    return a.actionNumber - b.actionNumber
  })
  const anyFilter = Boolean(query) || estado !== "todas" || frecuencia !== "todas"
  const retireTarget = actions.find((action) => action.id === retireTargetId) ?? null
  const resetFilters = () => { setSearch(""); clearFilters() }

  return (
    <div className="space-y-4">
      {mode.readOnlyReason && <Callout tone="info" title="Programa de sólo lectura">{mode.readOnlyReason}</Callout>}

      {programHeader ? (
        <ProgramHeader
          program={programHeader}
          header={header}
          progress={program.progress}
          canEdit={mode.canEdit}
          fichaHref={hrefToFicha(pathname, searchParams, true)}
          onEdit={() => setHeaderOpen(true)}
        />
      ) : (
        <EmptyState
          compact
          icon={<ClipboardText size={24} />}
          title="Esta MIPER todavía no tiene plan de medidas"
          // `\u2011`: guion que no parte línea; en la columna de 40ch el código quedaba «RE-» / «04.1».
          description={"El plan de medidas (Programa de Trabajo RE\u201104.1) convierte las medidas de la matriz en actividades con responsable y fecha. Se crea al empezar a generar las actividades o al agregar la primera."}
          action={mode.canEdit ? <Button size="sm" variant="secondary" onClick={() => setGenerateOpen(true)}>Generar actividades desde las medidas</Button> : undefined}
          secondaryAction={mode.canEdit ? <Button size="sm" variant="ghost" onClick={() => setHeaderOpen(true)}>Completar antecedentes</Button> : undefined}
        />
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <Field label="Buscar actividad del programa" htmlFor="miper-program-search" className="w-full sm:w-72">
              <Input
                id="miper-program-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Actividad, proceso o responsable…"
              />
            </Field>
            <Select value={estado} onValueChange={(value) => setFilter("estado", value === "todas" ? null : value)}>
              <SelectTrigger aria-label="Filtrar por estado de la actividad" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{ESTADO_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={frecuencia} onValueChange={(value) => setFilter("frecuencia", value === "todas" ? null : value)}>
              <SelectTrigger aria-label="Filtrar por frecuencia de la actividad" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{FRECUENCIA_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            {anyFilter && <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>Limpiar filtros</Button>}
          </div>

        </div>
      )}

      {actions.length === 0 ? (
        programHeader && (
          <EmptyState
            compact
            title="Este plan todavía no tiene actividades"
            description="Genera las actividades a partir de las medidas de la matriz o agrega la primera a mano."
            action={mode.canEdit ? <Button asChild size="sm" variant="secondary"><WorkspaceLink href={hrefToMatrix(pathname, searchParams)}>Revisar medidas de la matriz</WorkspaceLink></Button> : undefined}
          />
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          title="No hay actividades en este filtro"
          description="Prueba con otro estado, otra frecuencia o sin buscador."
          action={<Button size="sm" variant="secondary" onClick={resetFilters}>Ver todas las actividades</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="divide-y divide-[var(--color-border)]">
            {filtered.map((action) => (
              <ProgramActionCard
                key={action.id}
                action={action}
                matrixId={matrixId}
                mode={mode}
                userId={userId}
                users={users}
                processes={program.processes}
                defaultLocationLabel={programHeader?.worksiteName ?? null}
                today={today}
                detailHref={hrefToActivity(pathname, searchParams, action.id)}
                onRegister={(occurrence) => setRegisterTarget({ occurrence })}
                onRetire={() => setRetireTargetId(action.id)}
              />
            ))}
          </div>
        </div>
      )}

      {registerTarget && (
        <OccurrenceDialog
          open
          onOpenChange={(value) => { if (!value) setRegisterTarget(null) }}
          matrixId={matrixId}
          occurrence={{ id: registerTarget.occurrence.id, dueOn: registerTarget.occurrence.dueOn }}
          alreadyRecorded={registerTarget.occurrence.outcome !== "pending"}
          onRecorded={() => setRegisterTarget(null)}
        />
      )}

      {retireTarget && (
        <RetireActionDialog
          matrixId={matrixId}
          action={retireTarget}
          open
          onOpenChange={(value) => { if (!value) setRetireTargetId(null) }}
        />
      )}

      {/* Montado aunque ya exista el programa: abrirlo lo crea (`ensureProgram`) y, si
       * dependiera de `!programHeader`, una revalidación lo desmontaría abierto. */}
      {mode.canEdit && (
        <GenerateActionsDialog matrixId={matrixId} users={users} actions={actions.filter((action) => action.status === "active")}
          open={generateOpen} onOpenChange={setGenerateOpen} />
      )}
      <ProgramHeaderDialog open={headerOpen} onOpenChange={setHeaderOpen} matrixId={matrixId} program={programHeader} users={users} />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-[var(--color-text-subtle)]">Sin dato</span>}</dd>
    </div>
  )
}

/**
 * Encabezado RE-04.1 (§7.1). Los antecedentes de la empresa (nombre, RUT,
 * dirección, comuna, representante) son los de la ficha del documento y aquí
 * se leen, no se editan: se cambian en un solo lugar («Editar en la ficha»).
 * El programa aporta su período, la fecha de elaboración, el encargado y los
 * campos que se calculan.
 */
function ProgramHeader({ program, header, progress, canEdit, fichaHref, onEdit }: {
  program: ProgramHeaderView
  header: MiperSnapshot["header"]
  progress: ProgramProgress
  canEdit: boolean
  fichaHref: string
  onEdit: () => void
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-h3">Programa de Trabajo Preventivo RE-04.1</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Organiza las medidas en actividades y registra cada ejecución con su evidencia.</p>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-[var(--color-surface-2)] p-4">
        <Detail label="Período" value={String(program.period)} />
        <Detail label="Encargado del programa" value={program.programManagerName} />
        <Detail label="Avance del plan" value={progress.planned === 0 ? "Sin ejecuciones programadas" : `${progress.done}/${progress.planned} · ${ratioLabel(progress)}`} />
      </dl>
      <details className="group rounded-xl border border-[var(--color-border)] p-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium sm:min-h-0 [&::-webkit-details-marker]:hidden"><CaretRight aria-hidden className="size-3.5 group-open:rotate-90 motion-safe:transition-transform duration-[var(--duration-fast)]" />Datos del programa</summary>
        <div className="mt-3 space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Empresa" value={header.companyName} />
            <Detail label="Faena" value={header.worksiteName ?? program.worksiteName} />
            <Detail label="RUT" value={header.companyRut} />
            <Detail label="Dirección" value={header.companyAddress} />
            <Detail label="Comuna" value={header.companyCommune} />
            <Detail label="Representante de la empresa" value={header.siteRepresentativeName} />
            <Detail label="Fecha de elaboración" value={program.elaboratedOn ? formatDate(program.elaboratedOn) : null} />
            <Detail label="N° de centros de trabajo" value={String(program.worksiteCount)} />
            <Detail label="Fecha última revisión" value={program.lastReviewedOn ? formatDate(program.lastReviewedOn) : "Sin versión aprobada"} />
          </dl>
          {canEdit && <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary"><WorkspaceLink href={fichaHref} replace>Datos de empresa</WorkspaceLink></Button>
            <Button type="button" size="sm" variant="secondary" onClick={onEdit}>Responsable y fecha del programa</Button>
          </div>}
        </div>
      </details>
    </section>
  )
}

/**
 * Antecedentes propios del programa: sólo la fecha de elaboración y el
 * encargado. Todo lo demás es de la ficha. Con `program === null` («Completar
 * antecedentes») envía `expectedVersion: 1` y el servicio crea el programa.
 */
function ProgramHeaderDialog({ open, onOpenChange, matrixId, program, users }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  matrixId: string
  program: ProgramHeaderView | null
  users: Array<{ id: string; name: string }>
}) {
  const [managerId, setManagerId] = React.useState(program?.programManagerUserId ?? "")
  const [elaboratedOn, setElaboratedOn] = React.useState(program?.elaboratedOn ?? todayInChile())
  const operation = useOperation()

  // El diálogo queda montado: al abrir vuelve a lo guardado, no a lo que se dejó a medias.
  const { setMessage } = operation
  React.useEffect(() => {
    if (!open) return
    setManagerId(program?.programManagerUserId ?? "")
    setElaboratedOn(program?.elaboratedOn ?? todayInChile())
    setMessage("")
  }, [open, program, setMessage])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => saveProgramHeaderAction({
      matrixId,
      expectedVersion: program?.version ?? 1,
      elaboratedOn: elaboratedOn || null,
      programManagerUserId: managerId || null,
    }), () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Responsable y fecha del programa</DialogTitle>
            <DialogDescription>
              Los datos de la empresa y el representante se toman de la ficha del documento. Aquí sólo se fijan la fecha de elaboración y el encargado.
            </DialogDescription>
          </DialogHeader>
          <Field label="Fecha de elaboración del programa">
            <DatePicker value={elaboratedOn} onChange={setElaboratedOn} ariaLabel="Fecha de elaboración del programa" />
          </Field>
          <Field label="Encargado del programa">
            <OptionSelect
              aria-label="Encargado del programa"
              value={managerId}
              onValueChange={setManagerId}
              emptyLabel="Sin encargado"
              placeholder="Sin encargado"
              options={users.map((user) => ({ value: user.id, label: user.name }))}
            />
          </Field>
          {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending}>Guardar antecedentes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
