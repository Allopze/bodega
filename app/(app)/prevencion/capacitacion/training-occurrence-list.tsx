"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Buildings,
  CalendarBlank,
  Certificate,
  CheckCircle,
  DotsThree,
  Paperclip,
  Prohibit,
  WarningCircle,
} from "@phosphor-icons/react"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import {
  isPdtpPeriodOnOrAfterActivationPeriod,
  type PdtpPeriod,
} from "@/lib/services/pdtp/period"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { FileInput } from "@/components/ui/file-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StageTabs } from "@/components/ui/stage-tabs"
import { Textarea } from "@/components/ui/textarea"
import type {
  TrainingOccurrenceEvidenceListItem,
  TrainingOccurrenceListItem,
  TrainingOccurrenceStatus,
  TrainingOccurrenceStatusCounts,
  TrainingOccurrenceStatusFilter,
} from "@/lib/services/prevention-training-occurrences"
import { toast } from "@/lib/toast"
import { MONTH_NAMES, cn, formatDateTime } from "@/lib/utils"
import { recordTrainingOccurrenceStatusAction } from "./actions"
import { TRAINING_STATUS_TABS } from "./training-view"

interface Props {
  /** SÓLO la página visible: el servidor pagina y filtra (UX-01). Aquí no se filtra ni se cuenta nada. */
  rows: TrainingOccurrenceListItem[]
  /** Por estado, con año, faena, mes y texto pedidos pero sin el filtro de estado: lo que cada pestaña mostraría. */
  counts: TrainingOccurrenceStatusCounts
  /** La pestaña que el servidor aplicó (`?estado=`). */
  status: TrainingOccurrenceStatusFilter
  /** El texto de `?q=`, ya recortado. */
  search: string
  worksites: { id: string; name: string; isActive: boolean }[]
  selectedYear: number
  selectedWorksiteId: string
  /** El mes que el calendario de cumplimiento filtra (1–12), o `null` si se ven todos. */
  selectedMonth: number | null
  /** «Programa anual 2026 · versión 1». */
  programLabel: string
  /**
   * ¿El programa del año tiene casillas en el alcance? Lo decide el alcance
   * completo (el calendario), no la página: una página vacía por un filtro no es
   * «el programa no está cargado».
   */
  hasProgram: boolean
  canRecord: boolean
  /** Desde cuándo exige el programa a CADA faena; `null` o ausente = desde el comienzo del año. */
  activationByWorksite: Record<string, PdtpPeriod | null>
  /** La misma vista sin mes, estado, texto ni página (conserva faena y año). */
  clearFiltersHref: string
  /** La misma vista con todos los estados (conserva faena y mes). */
  showAllHref: string
  /** `ServerPagination` ya armado en el servidor (sus enlaces son funciones de la URL). */
  pagination?: React.ReactNode
}

/* Los rótulos de las pestañas son plurales («Hechas»): nombran un conjunto. El
 * del badge de una tarjeta nombra UNA actividad, y «Hechas» sobre una sola
 * actividad se lee mal. Son dos mapas a propósito. */
const STATUS_BADGE_LABELS: Record<TrainingOccurrenceStatus, string> = {
  pending: "Pendiente",
  completed: "Hecha",
  not_completed: "No hecha",
  not_applicable: "No aplica",
}

function statusMeta(status: TrainingOccurrenceStatus): StateMetaInput {
  const label = STATUS_BADGE_LABELS[status]
  if (status === "completed") return { label, variant: "success" }
  if (status === "not_completed") return { label, variant: "danger" }
  /* "No aplica" es neutro a propósito: no es un logro ni una falta, es una
   * actividad que salió del denominador. Pintarla de verde o de rojo invita a
   * leerla como cumplimiento o como incumplimiento, y no es ninguna de las dos. */
  if (status === "not_applicable") return { label, variant: "outline" }
  return { label, variant: "warning" }
}

function typeMeta(itemType: string): StateMetaInput {
  return { label: itemType === "campaign" ? "Campaña" : "Capacitación", variant: itemType === "campaign" ? "info" : "primary" }
}

function scheduleLabel(row: TrainingOccurrenceListItem): string {
  if (!row.scheduledMonth || !row.scheduledWeek) return "Sin fecha programada"
  return `${MONTH_NAMES[row.scheduledMonth - 1] ?? `mes ${row.scheduledMonth}`} · semana ${row.scheduledWeek}`
}

function activeEvidence(row: TrainingOccurrenceListItem): TrainingOccurrenceEvidenceListItem[] {
  return row.evidence.filter((evidence) => evidence.state === "active")
}

function evidenceStateLabel(state: TrainingOccurrenceEvidenceListItem["state"]): string {
  if (state === "annulled") return "Anulada · historial"
  if (state === "replaced") return "Reemplazada · historial"
  return "Activa"
}

function evidenceHref(storagePath: string): string {
  const name = storagePath.split("/").at(-1) ?? ""
  return `/api/prevencion/capacitacion/evidence/${encodeURIComponent(name)}`
}

function evidenceCountLabel(row: TrainingOccurrenceListItem): string {
  const activeCount = activeEvidence(row).length
  const historicalCount = row.evidence.length - activeCount
  const activeLabel = `${activeCount} ${activeCount === 1 ? "evidencia activa" : "evidencias activas"}`
  if (historicalCount === 0) return activeLabel
  return `${activeLabel} · ${historicalCount} ${historicalCount === 1 ? "histórica" : "históricas"}`
}

function activeEvidenceCountLabel(row: TrainingOccurrenceListItem): string {
  const count = activeEvidence(row).length
  return `${count} ${count === 1 ? "evidencia activa" : "evidencias activas"}`
}

type DialogTargetStatus = Exclude<TrainingOccurrenceStatus, "pending">

/** Lo que el diálogo único necesita saber: una FOTO de la fila, no su id. La fila puede salir de la lista tras revalidar. */
interface DialogSnapshot {
  row: TrainingOccurrenceListItem
  target: DialogTargetStatus
  /** Cambia en cada apertura: reabrir la misma fila y el mismo destino parte de un formulario limpio. */
  nonce: number
}

/**
 * Qué se ofrece sobre una actividad según su estado: UNA acción principal (la
 * que casi siempre se quiere) y el resto en «Más acciones». Antes eran hasta
 * tres botones por tarjeta, cada uno con su propio diálogo montado: en una
 * página de 25 eran 75 diálogos. Las reglas de qué destinos existen no cambian:
 * todos menos el estado en que ya está.
 */
const ACTIONS_BY_STATUS: Record<TrainingOccurrenceStatus, { primary: DialogTargetStatus; more: DialogTargetStatus[] }> = {
  pending: { primary: "completed", more: ["not_completed", "not_applicable"] },
  completed: { primary: "not_completed", more: ["not_applicable"] },
  not_completed: { primary: "completed", more: ["not_applicable"] },
  not_applicable: { primary: "completed", more: ["not_completed"] },
}

function actionLabel(target: DialogTargetStatus, current: TrainingOccurrenceStatus): string {
  if (target === "completed") return "Marcar hecha"
  if (target === "not_applicable") return "No aplica"
  return current === "completed" ? "Corregir a no hecha" : "Marcar no hecha"
}

function ActionIcon({ target }: { target: DialogTargetStatus }) {
  if (target === "completed") return <CheckCircle size={15} aria-hidden />
  if (target === "not_applicable") return <Prohibit size={15} aria-hidden />
  return <WarningCircle size={15} aria-hidden />
}

export function TrainingOccurrenceList({
  rows,
  counts,
  status,
  search,
  worksites,
  selectedYear,
  selectedWorksiteId,
  selectedMonth,
  programLabel,
  hasProgram,
  canRecord,
  activationByWorksite,
  clearFiltersHref,
  showAllHref,
  pagination,
}: Props) {
  useWorksiteFilterPresence()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [dialog, setDialog] = React.useState<DialogSnapshot | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const dialogNonce = React.useRef(0)

  const selectedWorksite = worksites.find((worksite) => worksite.id === selectedWorksiteId)
  const selectedWorksiteLabel = !selectedWorksiteId
    ? "Todas las faenas"
    : !selectedWorksite
      ? "Faena no disponible"
      : selectedWorksite.isActive ? selectedWorksite.name : `${selectedWorksite.name} (inactiva · solo lectura)`

  /* Faena, mes, estado y texto son estado de la vista y viajan en la URL, así
   * que un cambio parte de lo que ya hay y conserva el resto. La página sí se
   * suelta: la 3 de «Pendientes» no existe en «Hechas». `replace` + `scroll:
   * false`, igual que el resto de los filtros (AGENTS.md, navegación). */
  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    params.delete("page")
    params.delete("anio")
    params.set("year", String(selectedYear))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const openDialog = React.useCallback((row: TrainingOccurrenceListItem, target: DialogTargetStatus) => {
    dialogNonce.current += 1
    setDialog({ row, target, nonce: dialogNonce.current })
    setDialogOpen(true)
  }, [])

  const tabs = TRAINING_STATUS_TABS.map((tab) => ({
    value: tab.value,
    label: tab.label,
    count: counts[tab.status],
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-xs">
        <Field label="Faena" htmlFor="training-worksite-filter" className="min-w-[15rem] flex-1 sm:flex-none">
          <Select
            value={selectedWorksiteId || "all"}
            onValueChange={(value) => navigate((params) => {
              if (value === "all") params.delete("faena")
              else params.set("faena", value)
            })}
          >
            <SelectTrigger id="training-worksite-filter" aria-label="Filtrar por faena" className="h-9 text-sm">
              {/* Hijos explícitos: en el servidor Radix no sabe el texto del valor
                * «all» y dejaba el selector en blanco hasta hidratar. */}
              <SelectValue placeholder="Todas las faenas">{selectedWorksiteLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las faenas</SelectItem>
              {worksites.filter((worksite) => worksite.isActive).map((worksite) => (
                <SelectItem key={worksite.id} value={worksite.id} textValue={worksite.name}>
                  {worksite.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <React.Suspense fallback={null}>
          <FilterSearchInput
            param="q"
            placeholder="Buscar actividad o faena"
            ariaLabel="Buscar actividad o faena"
            className="h-11 w-full pl-8 text-sm sm:h-9 sm:w-72"
          />
        </React.Suspense>
        <p className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
          <Certificate size={16} aria-hidden />
          <span>{programLabel}</span>
        </p>
      </div>

      {selectedMonth !== null && (
        <FilterToolbar
          className="mb-0"
          activeChips={[{
            key: "mes",
            label: "Mes",
            value: String(selectedMonth),
            displayValue: `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`,
          }]}
          onRemoveChip={() => navigate((params) => params.delete("mes"))}
        />
      )}

      {/* Las pestañas son enlaces (`StageTabs`): cambian la URL y el servidor
        * vuelve a consultar. El alto se reserva mientras `useSearchParams` espera. */}
      <React.Suspense fallback={<div className="h-11 border-b border-[var(--color-border)] sm:h-9" aria-hidden />}>
        <StageTabs tabs={tabs} ariaLabel="Filtrar por estado" />
      </React.Suspense>

      {rows.length === 0 ? (
        <EmptyList
          hasProgram={hasProgram}
          status={status}
          search={search}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          clearFiltersHref={clearFiltersHref}
          showAllHref={showAllHref}
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <TrainingOccurrenceCard
              key={row.id}
              row={row}
              canRecord={canRecord}
              activationPeriod={activationByWorksite[row.worksiteId] ?? null}
              onAction={openDialog}
            />
          ))}
        </div>
      )}
      {pagination}

      {/* UN diálogo para toda la lista: lo abre la tarjeta que se toca y lleva
        * la foto de su fila. El formulario se reinicia con `key`. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {dialog && (
          <DialogContent aria-describedby="training-occurrence-dialog-description">
            <TrainingOccurrenceForm
              key={`${dialog.row.id}:${dialog.target}:${dialog.nonce}`}
              row={dialog.row}
              target={dialog.target}
              onClose={() => setDialogOpen(false)}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

/** Tres vacíos distintos, porque llevan a tres salidas distintas (A4): significado + qué hacer + CTA real. */
function EmptyList({
  hasProgram,
  status,
  search,
  selectedMonth,
  selectedYear,
  clearFiltersHref,
  showAllHref,
}: {
  hasProgram: boolean
  status: TrainingOccurrenceStatusFilter
  search: string
  selectedMonth: number | null
  selectedYear: number
  clearFiltersHref: string
  showAllHref: string
}) {
  /* Sin casillas en TODO el alcance: el programa del año no está sembrado. Se
   * decide por el alcance completo, no por esta página: una página vacía por un
   * filtro no es «el programa no está cargado». */
  if (!hasProgram) {
    return (
      <EmptyState
        icon={<Certificate size={24} />}
        title={`El programa ${selectedYear} aún no tiene actividades`}
        description="El catálogo anual se genera para cada faena activa. Revisa que exista una faena activa y que el programa controlado esté cargado."
        action={
          <Button asChild variant="secondary">
            <Link href="/prevencion/faenas">Revisar faenas</Link>
          </Button>
        }
      />
    )
  }
  /* «Pendientes» vacío sin texto de búsqueda no es un fallo del filtro: es la
   * buena noticia. */
  if (status === "pending" && !search) {
    return (
      <EmptyState
        icon={<CheckCircle size={24} />}
        tone="success"
        title={selectedMonth ? `No hay actividades pendientes en ${MONTH_NAMES[selectedMonth - 1]}` : "No hay actividades pendientes"}
        description="Todo lo programado ya tiene un estado registrado. Revisa el historial en las demás pestañas."
        action={
          <Button asChild variant="secondary">
            <Link href={showAllHref} scroll={false} replace>Ver todas</Link>
          </Button>
        }
      />
    )
  }
  return (
    <EmptyState
      icon={<Certificate size={24} />}
      title="Sin coincidencias"
      description="Ninguna actividad cumple estos filtros. Prueba con otro estado, otro mes o con otra búsqueda."
      action={
        <Button asChild variant="secondary">
          <Link href={clearFiltersHref} scroll={false} replace>Limpiar filtros</Link>
        </Button>
      }
    />
  )
}

/* El PDTP se vuelve exigible al activarse la versión aprobada, no el 1 de
 * enero. Una casilla anterior a esa semana sigue pendiente y se puede hacer
 * tarde —la actividad no se canceló—, pero el barrido no abre compromiso por
 * ella. Se dice en pantalla para que nadie corra a ejecutar algo que nadie le
 * estaba pidiendo. La activación es la de LA FAENA de la tarjeta: una faena
 * incorporada en marzo no exige enero, aunque otra sí. */
function isBeforeActivation(row: TrainingOccurrenceListItem, activation: PdtpPeriod | null): boolean {
  if (!activation || row.scheduledMonth === null || row.scheduledWeek === null) return false
  return !isPdtpPeriodOnOrAfterActivationPeriod(
    { year: row.year, month: row.scheduledMonth, week: row.scheduledWeek },
    activation,
  )
}

function TrainingOccurrenceCard({
  row,
  canRecord,
  activationPeriod,
  onAction,
}: {
  row: TrainingOccurrenceListItem
  canRecord: boolean
  activationPeriod: PdtpPeriod | null
  onAction: (row: TrainingOccurrenceListItem, target: DialogTargetStatus) => void
}) {
  const evidence = row.evidence
  const actions = ACTIONS_BY_STATUS[row.status]
  return (
    <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold tracking-wide text-[var(--color-text-subtle)]">{row.code}</span>
            <MetaBadge meta={typeMeta(row.itemType)} />
            <MetaBadge meta={statusMeta(row.status)} dot />
          </div>
          <h2 className="max-w-4xl text-base font-semibold leading-snug text-[var(--color-text)]">{row.title}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5"><Buildings size={15} aria-hidden />{row.worksiteName}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarBlank size={15} aria-hidden />{scheduleLabel(row)}</span>
            <span>{row.audience}</span>
          </div>
        </div>
        {canRecord && row.worksiteActive && (
          <div className="flex shrink-0 items-center gap-2 lg:justify-end">
            <Button
              type="button"
              variant={actions.primary === "completed" ? "primary" : "secondary"}
              onClick={() => onAction(row, actions.primary)}
            >
              <ActionIcon target={actions.primary} />
              {actionLabel(actions.primary, row.status)}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="icon" aria-label={`Más acciones de ${row.code}`}>
                  <DotsThree size={18} weight="bold" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.more.map((target) => (
                  <DropdownMenuItem key={target} className="gap-2" onSelect={() => onAction(row, target)}>
                    <ActionIcon target={target} />
                    {actionLabel(target, row.status)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {!row.worksiteActive && (
          <p className="text-xs font-medium text-[var(--color-text-subtle)]">Historial de una faena inactiva; solo lectura.</p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border)] pt-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
            <Paperclip size={14} aria-hidden />
            {evidenceCountLabel(row)}
          </p>
          {evidence.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {evidence.map((item) => (
                <a
                  key={item.id}
                  href={evidenceHref(item.storagePath)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "max-w-full truncate text-xs underline-offset-2 hover:underline",
                    item.state === "active"
                      ? "text-[var(--color-primary-ink)]"
                      : "text-[var(--color-text-subtle)]",
                  )}
                >
                  <span>{item.fileName}</span>
                  <span className="ml-1.5">({evidenceStateLabel(item.state)})</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="text-xs text-[var(--color-text-subtle)] sm:text-right">
          {row.status === "completed" && row.completedAt ? (
            <>
              <span>Marcada el {formatDateTime(row.completedAt)}</span>
              {row.completedByName && <span className="block">por {row.completedByName}</span>}
            </>
          ) : row.status === "not_applicable" ? (
            <span className="inline-flex max-w-xl items-start gap-1.5 text-left sm:text-right"><Prohibit size={14} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" aria-hidden />{row.notApplicableReason}</span>
          ) : row.status === "not_completed" && row.observation ? (
            <span className="inline-flex max-w-xl items-start gap-1.5 text-left sm:text-right"><WarningCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-danger-ink)]" aria-hidden />{row.observation}</span>
          ) : isBeforeActivation(row, activationPeriod) ? (
            <span>Anterior a la activación del programa: no se exige, pero se puede registrar si se realiza.</span>
          ) : (
            <span>Requiere registro del prevencionista de faena</span>
          )}
        </div>
      </div>
    </article>
  )
}

/** El motivo mínimo de "no aplica". Debe coincidir con el CHECK de la tabla y
 *  con el `superRefine` del servicio: el formulario avisa antes, no decide. */
const NOT_APPLICABLE_REASON_MIN = 10

/* El diálogo era un ternario `completed ? … : …` de punta a punta. Con tres
 * destinos eso obliga a anidar, y cada anidación es un lugar donde el estado
 * nuevo hereda por descuido el texto del viejo. La copia vive acá, declarada. */
const DIALOG_COPY: Record<DialogTargetStatus, {
  title: string
  confirmLabel: string
  confirmVariant: "primary" | "destructive" | "secondary"
  notice: { tone: "success" | "warning" | "neutral"; text: string }
  observationLabel: string
  observationHelper: string
  observationPlaceholder: string
  observationRequired: boolean
}> = {
  completed: {
    title: "Marcar capacitación como hecha",
    confirmLabel: "Confirmar hecha",
    confirmVariant: "primary",
    notice: { tone: "success", text: "Para confirmar el hecho se necesita al menos una evidencia. Puedes subir PDF, DOCX, XLS/XLSX, JPG o PNG." },
    observationLabel: "Observación",
    observationHelper: "Opcional: deja contexto sobre la actividad realizada.",
    observationPlaceholder: "Ej.: actividad ejecutada en reunión mensual...",
    observationRequired: false,
  },
  not_completed: {
    title: "Marcar capacitación como no hecha",
    confirmLabel: "Confirmar no hecha",
    confirmVariant: "destructive",
    notice: { tone: "warning", text: "Las evidencias activas de esta ocurrencia se conservarán como historial y no podrán reutilizarse si se vuelve a marcar como hecha." },
    observationLabel: "Observación",
    observationHelper: "Opcional: explica por qué no se realizó.",
    observationPlaceholder: "Ej.: se reprogramará por...",
    observationRequired: false,
  },
  not_applicable: {
    title: "Declarar que la capacitación no aplica",
    confirmLabel: "Confirmar no aplica",
    confirmVariant: "secondary",
    notice: { tone: "neutral", text: "Queda en revisión hasta que otra persona lo apruebe. Si lo aprueba, la actividad sale del programa de esta faena: no cuenta como cumplida ni como incumplida. El motivo queda registrado y es lo que un fiscalizador va a leer." },
    observationLabel: "Motivo",
    observationHelper: `Obligatorio: explica por qué no corresponde en esta faena (al menos ${NOT_APPLICABLE_REASON_MIN} caracteres).`,
    observationPlaceholder: "Ej.: la faena no opera equipos de izaje, por lo que el curso no corresponde.",
    observationRequired: true,
  },
}

const NOTICE_CLASS: Record<"success" | "warning" | "neutral", string> = {
  success: "bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
  warning: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
  neutral: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
}

/**
 * El contenido del diálogo único. Se monta con `key` por apertura, así que su
 * estado (observación, archivos) nace limpio cada vez y no hay que resetearlo a
 * mano al cerrar.
 *
 * Tras guardar NO se llama `router.refresh()`: la acción de servidor ya hace
 * `revalidatePath` y devuelve la página nueva en la misma respuesta; pedir otro
 * refresh encima, en Next 16, se convierte en una recarga completa. Sólo el
 * cierre por carga parcial lo conserva, porque la ruta de evidencias no revalida.
 */
function TrainingOccurrenceForm({
  row,
  target,
  onClose,
}: {
  row: TrainingOccurrenceListItem
  target: DialogTargetStatus
  onClose: () => void
}) {
  const copy = DIALOG_COPY[target]
  const router = useRouter()
  const [observation, setObservation] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [pending, startTransition] = React.useTransition()
  const existingEvidenceCount = activeEvidence(row).length

  function submit() {
    if (target === "completed" && files.length === 0 && existingEvidenceCount === 0) {
      toast.error("Adjunta al menos un PDF, documento Office o foto para marcarla como hecha.")
      return
    }
    if (target === "not_applicable" && observation.trim().length < NOT_APPLICABLE_REASON_MIN) {
      toast.error(`Explica por qué la capacitación no aplica (al menos ${NOT_APPLICABLE_REASON_MIN} caracteres).`)
      return
    }

    startTransition(async () => {
      let uploadedFileCount = 0
      const closeAfterPartialUpload = (message: string) => {
        toast.error(`${message} La evidencia que alcanzó a cargarse quedó guardada; se cerró el formulario para evitar duplicarla.`)
        onClose()
        router.refresh()
      }
      try {
        for (const file of files) {
          const form = new FormData()
          form.set("occurrenceId", row.id)
          form.set("file", file)
          const response = await fetch("/api/prevencion/capacitacion/evidence", { method: "POST", body: form })
          if (!response.ok) {
            const payload = await response.json().catch(() => ({})) as { error?: string }
            throw new Error(payload.error ?? "No se pudo subir una evidencia.")
          }
          uploadedFileCount += 1
        }

        /* En "no aplica" el textarea ES el motivo y viaja por su propio campo:
         * el CHECK de la tabla lo exige ahí, no en la observación. */
        const result = await recordTrainingOccurrenceStatusAction({
          occurrenceId: row.id,
          expectedVersion: row.version,
          status: target,
          observation: target === "not_applicable" ? null : (observation.trim() || null),
          notApplicableReason: target === "not_applicable" ? observation.trim() : null,
        })
        if (!result.ok) {
          if (uploadedFileCount > 0) {
            closeAfterPartialUpload(result.message ?? "No se pudo actualizar la capacitación.")
            return
          }
          toast.error(result.message ?? "No se pudo actualizar la capacitación.")
          return
        }
        toast.success(result.message ?? "Capacitación actualizada.")
        onClose()
      } catch (error) {
        if (uploadedFileCount > 0) {
          closeAfterPartialUpload(error instanceof Error ? error.message : "No se pudo completar la operación.")
          return
        }
        toast.error(error instanceof Error ? error.message : "No se pudo completar la operación.")
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription id="training-occurrence-dialog-description">
          {row.code} · {row.title} · {row.worksiteName}
        </DialogDescription>
      </DialogHeader>

      {target === "completed" ? (
        <div className="space-y-4">
          <div className={`rounded-xl px-3.5 py-3 text-sm ${NOTICE_CLASS[copy.notice.tone]}`}>
            {copy.notice.text}
          </div>
          <Field
            label="Evidencia"
            htmlFor={`training-evidence-${row.id}`}
            required={existingEvidenceCount === 0}
            helper="Máximo 25 MB por archivo. Las evidencias se conservan como historial."
          >
            <FileInput
              id={`training-evidence-${row.id}`}
              multiple
              accept=".pdf,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png"
              onFilesChange={setFiles}
              disabled={pending}
            />
          </Field>
          {existingEvidenceCount > 0 && (
            <p className="text-xs text-[var(--color-text-subtle)]">Ya existen {activeEvidenceCountLabel(row)}; puedes agregar más si corresponde.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-xl px-3.5 py-3 text-sm ${NOTICE_CLASS[copy.notice.tone]}`}>
            {copy.notice.text}
          </div>
        </div>
      )}

      <Field
        label={copy.observationLabel}
        htmlFor={`training-observation-${row.id}`}
        helper={copy.observationHelper}
        required={copy.observationRequired}
        className="mt-4"
      >
        <Textarea
          id={`training-observation-${row.id}`}
          value={observation}
          onChange={(event) => setObservation(event.target.value)}
          maxLength={target === "not_applicable" ? 1000 : 3000}
          placeholder={copy.observationPlaceholder}
          disabled={pending}
        />
      </Field>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button type="button" variant={copy.confirmVariant} onClick={submit} loading={pending}>
          {copy.confirmLabel}
        </Button>
      </DialogFooter>
    </>
  )
}
