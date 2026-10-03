"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { ClipboardText, Plus } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ProgramProgress } from "@/lib/prevention/miper/progress"
import type { MiperEntrySnapshot, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { hrefToActivity, hrefToFicha, hrefToTab, PROGRAM_FILTER_KEYS } from "@/lib/prevention/miper/workspace-url"
import type { ProgramHeaderView, ProgramOccurrenceView, ProgramWorkspace } from "@/lib/services/miper/program-queries"
import { formatDate, todayInChile } from "@/lib/utils"
import { saveProgramHeaderAction } from "../actions"
import { GenerateActionsDialog } from "./generate-actions-dialog"
import { OccurrenceDialog } from "./occurrence-dialog"
import { ProgramActionCard, ratioLabel } from "./program-action-card"
import { PROGRAM_SCHEDULE_OPTIONS, ProgramActionDialog, RetireActionDialog } from "./program-action-dialog"
import { ProgramActivityView } from "./program-activity-view"
import { useWorkspaceFilterNavigation } from "./use-workspace-filter-navigation"
import { WorkspaceLink } from "./workspace-nav"

export { ActionProgress } from "./program-action-card"

const ESTADO_OPTIONS = [
  { value: "todas", label: "Todas las actividades" },
  { value: "activas", label: "Sólo activas" },
  { value: "retiradas", label: "Sólo retiradas" },
  { value: "vencidas", label: "Con ocurrencias vencidas" },
  { value: "incumplidas", label: "Con ocurrencias incumplidas" },
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
  })
  const anyFilter = Boolean(query) || estado !== "todas" || frecuencia !== "todas"
  const retireTarget = actions.find((action) => action.id === retireTargetId) ?? null
  const activeActions = actions.filter((action) => action.status === "active")
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
          title="Esta MIPER todavía no tiene Programa de Trabajo"
          description="El Programa de Trabajo toma las medidas del MIPER y las convierte en actividades con responsable y fecha. Se crea al generar las actividades o al agregar la primera."
          action={mode.canEdit ? (
            <GenerateActionsDialog
              matrixId={matrixId}
              users={users}
              actions={activeActions}
              trigger={<Button size="sm">Generar actividades</Button>}
            />
          ) : undefined}
          secondaryAction={mode.canEdit ? <Button size="sm" variant="secondary" onClick={() => setHeaderOpen(true)}>Completar antecedentes</Button> : undefined}
        />
      )}

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
        {mode.canEdit && programHeader && (
          <div className="flex flex-wrap items-center gap-2">
            <GenerateActionsDialog
              matrixId={matrixId}
              users={users}
              actions={activeActions}
              trigger={<Button size="sm" variant="secondary">Generar actividades</Button>}
            />
            <ProgramActionDialog
              matrixId={matrixId}
              processes={program.processes}
              users={users}
              defaultLocationLabel={programHeader.worksiteName}
              trigger={<Button size="sm"><Plus size={14} className="mr-1.5" />Nueva actividad</Button>}
            />
          </div>
        )}
      </div>

      {actions.length === 0 ? (
        programHeader && (
          <EmptyState
            compact
            title="Este programa todavía no tiene actividades"
            description="Genera las actividades a partir de las medidas del MIPER o agrega la primera a mano."
            action={mode.canEdit ? (
              <GenerateActionsDialog
                matrixId={matrixId}
                users={users}
                actions={activeActions}
                trigger={<Button size="sm">Generar actividades</Button>}
              />
            ) : undefined}
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

      <ProgramHeaderDialog open={headerOpen} onOpenChange={setHeaderOpen} matrixId={matrixId} program={programHeader} users={users} />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-eyebrow">{label}</dt>
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
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-h3">Programa de Trabajo Preventivo RE-04.1</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">
            {header.companyName ?? "Empresa sin nombre"} · {header.worksiteName ?? program.worksiteName ?? "Centro sin nombre"} · período {program.period}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{`${progress.done}/${progress.planned} realizadas`}</Badge>
          {canEdit && (
            <Button asChild size="sm" variant="ghost">
              <WorkspaceLink href={fichaHref} replace>Editar en la ficha</WorkspaceLink>
            </Button>
          )}
          {canEdit && <Button type="button" size="sm" variant="secondary" onClick={onEdit}>Editar antecedentes</Button>}
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="RUT" value={header.companyRut} />
        <Detail label="Dirección" value={header.companyAddress} />
        <Detail label="Comuna" value={header.companyCommune} />
        <Detail label="Representante de la empresa" value={header.siteRepresentativeName} />
        <Detail label="Fecha de elaboración" value={program.elaboratedOn ? formatDate(program.elaboratedOn) : null} />
        <Detail label="Encargado del programa" value={program.programManagerName} />
        <Detail label="N° de centros de trabajo" value={String(program.worksiteCount)} />
        <Detail label="Fecha última revisión" value={program.lastReviewedOn ? formatDate(program.lastReviewedOn) : "Sin versión sellada"} />
        <Detail label="Avance del programa" value={`${progress.done}/${progress.planned} · ${ratioLabel(progress)}`} />
      </dl>
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
            <DialogTitle>Antecedentes del Programa de Trabajo</DialogTitle>
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
