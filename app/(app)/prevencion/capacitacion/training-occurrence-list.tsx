"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Buildings,
  CalendarBlank,
  Certificate,
  CheckCircle,
  Paperclip,
  Prohibit,
  WarningCircle,
} from "@phosphor-icons/react"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useSafeShellHeader } from "@/components/layout/header-context"
import type {
  TrainingOccurrenceEvidenceListItem,
  TrainingOccurrenceListItem,
} from "@/lib/services/prevention-training-occurrences"
import { toast } from "@/lib/toast"
import { cn, formatDateTime } from "@/lib/utils"
import { recordTrainingOccurrenceStatusAction } from "./actions"

interface Props {
  rows: TrainingOccurrenceListItem[]
  worksites: { id: string; name: string; isActive: boolean }[]
  selectedYear: number
  selectedWorksiteId: string
  canRecord: boolean
}

type StatusFilter = "all" | "pending" | "completed" | "not_completed" | "not_applicable"

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/* Las pestañas se arman iterando estas claves, así que agregar un estado acá
 * lo agrega también al filtro y a los contadores. */
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Todas",
  pending: "Pendientes",
  completed: "Hechas",
  not_completed: "No hechas",
  not_applicable: "No aplican",
}

function statusLabel(status: TrainingOccurrenceListItem["status"]): string {
  return STATUS_LABELS[status]
}

function statusMeta(status: TrainingOccurrenceListItem["status"]): StateMetaInput {
  if (status === "completed") return { label: statusLabel(status), variant: "success" }
  if (status === "not_completed") return { label: statusLabel(status), variant: "danger" }
  /* "No aplica" es neutro a propósito: no es un logro ni una falta, es una
   * actividad que salió del denominador. Pintarla de verde o de rojo invita a
   * leerla como cumplimiento o como incumplimiento, y no es ninguna de las dos. */
  if (status === "not_applicable") return { label: statusLabel(status), variant: "outline" }
  return { label: statusLabel(status), variant: "warning" }
}

function typeMeta(itemType: string): StateMetaInput {
  return { label: itemType === "campaign" ? "Campaña" : "Curso", variant: itemType === "campaign" ? "info" : "primary" }
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

function updateRoute(router: ReturnType<typeof useRouter>, pathname: string, worksiteId: string, year: number) {
  const params = new URLSearchParams()
  if (worksiteId) params.set("faena", worksiteId)
  params.set("year", String(year))
  router.replace(`${pathname}?${params.toString()}`)
}

export function TrainingOccurrenceList({ rows, worksites, selectedYear, selectedWorksiteId, canRecord }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")

  const counts = React.useMemo(() => ({
    all: rows.length,
    pending: rows.filter((row) => row.status === "pending").length,
    completed: rows.filter((row) => row.status === "completed").length,
    not_completed: rows.filter((row) => row.status === "not_completed").length,
    not_applicable: rows.filter((row) => row.status === "not_applicable").length,
  }), [rows])

  const filteredRows = React.useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("es-CL")
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false
      if (!query) return true
      return [row.code, row.title, row.worksiteName, row.audience]
        .some((value) => value.toLocaleLowerCase("es-CL").includes(query))
    })
  }, [rows, searchQuery, statusFilter])

  const clearSearch = () => setSearchQuery("")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-xs">
        <Field label="Faena" htmlFor="training-worksite-filter" className="min-w-[15rem] flex-1 sm:flex-none">
          <Select
            value={selectedWorksiteId || "all"}
            onValueChange={(value) => updateRoute(router, pathname, value === "all" ? "" : value, selectedYear)}
          >
            <SelectTrigger id="training-worksite-filter" aria-label="Filtrar por faena" className="h-9 text-sm">
              <SelectValue placeholder="Todas las faenas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las faenas</SelectItem>
              {worksites.map((worksite) => (
                <SelectItem key={worksite.id} value={worksite.id} textValue={worksite.name}>
                  {worksite.name}{worksite.isActive ? "" : " (inactiva)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Programa" htmlFor="training-program" className="w-48">
          <output id="training-program" className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text)]">
            Programa anual {selectedYear}
          </output>
        </Field>
        <div className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
          <Certificate size={16} aria-hidden />
          <span>Catálogo anual controlado · {rows[0]?.catalogVersion ?? "programa 2026"}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]" role="tablist" aria-label="Filtrar por estado">
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((status) => {
          const active = statusFilter === status
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "-mb-px rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-[var(--color-primary)] text-[var(--color-primary-ink)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-control-hover)] hover:text-[var(--color-text)]",
              )}
            >
              {STATUS_LABELS[status]}
              <span className="ml-1.5 font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{counts[status]}</span>
            </button>
          )
        })}
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState
          icon={<Certificate size={24} />}
          title={rows.length === 0 ? "No hay ocurrencias para mostrar" : "Sin coincidencias"}
          description={rows.length === 0
            ? "El catálogo anual se genera para cada faena activa. Revisa que exista una faena activa y que el programa controlado esté cargado."
            : "Prueba con otro estado o limpia el texto de búsqueda del encabezado."}
          action={rows.length === 0 ? (
            <Button asChild variant="secondary">
              <Link href="/prevencion/faenas">Revisar faenas</Link>
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => { setStatusFilter("all"); clearSearch() }}>
              Limpiar filtros
            </Button>
          )}
        />
      ) : (
        <div className="grid gap-3">
          {filteredRows.map((row) => (
            <TrainingOccurrenceCard key={row.id} row={row} canRecord={canRecord} />
          ))}
        </div>
      )}
    </div>
  )
}

function TrainingOccurrenceCard({ row, canRecord }: { row: TrainingOccurrenceListItem; canRecord: boolean }) {
  const evidence = row.evidence
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
          <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
            {row.status !== "completed" && (
              <TrainingOccurrenceDialog row={row} targetStatus="completed" triggerLabel="Marcar hecha" />
            )}
            {row.status !== "not_completed" && (
              <TrainingOccurrenceDialog row={row} targetStatus="not_completed" triggerLabel={row.status === "completed" ? "Corregir a no hecha" : "Marcar no hecha"} />
            )}
            {row.status !== "not_applicable" && (
              <TrainingOccurrenceDialog row={row} targetStatus="not_applicable" triggerLabel="No aplica" />
            )}
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
          ) : (
            <span>Requiere registro del prevencionista de faena</span>
          )}
        </div>
      </div>
    </article>
  )
}

type DialogTargetStatus = Exclude<TrainingOccurrenceListItem["status"], "pending">

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
    notice: { tone: "neutral", text: "La actividad saldrá del programa de esta faena: no cuenta como cumplida ni como incumplida. El motivo queda registrado y es lo que un fiscalizador va a leer." },
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

function TrainingOccurrenceDialog({
  row,
  targetStatus,
  triggerLabel,
}: {
  row: TrainingOccurrenceListItem
  targetStatus: DialogTargetStatus
  triggerLabel: string
}) {
  const copy = DIALOG_COPY[targetStatus]
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [observation, setObservation] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [pending, startTransition] = React.useTransition()
  const existingEvidenceCount = activeEvidence(row).length

  function reset() {
    setObservation("")
    setFiles([])
  }

  function submit() {
    if (targetStatus === "completed" && files.length === 0 && existingEvidenceCount === 0) {
      toast.error("Adjunta al menos un PDF, documento Office o foto para marcarla como hecha.")
      return
    }
    if (targetStatus === "not_applicable" && observation.trim().length < NOT_APPLICABLE_REASON_MIN) {
      toast.error(`Explica por qué la capacitación no aplica (al menos ${NOT_APPLICABLE_REASON_MIN} caracteres).`)
      return
    }

    startTransition(async () => {
      let uploadedFileCount = 0
      const closeAfterPartialUpload = (message: string) => {
        toast.error(`${message} La evidencia que alcanzó a cargarse quedó guardada; se cerró el formulario para evitar duplicarla.`)
        setOpen(false)
        reset()
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
          status: targetStatus,
          observation: targetStatus === "not_applicable" ? null : (observation.trim() || null),
          notApplicableReason: targetStatus === "not_applicable" ? observation.trim() : null,
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
        setOpen(false)
        reset()
        router.refresh()
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && !pending) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={targetStatus === "completed" ? "primary" : "secondary"}>
          {targetStatus === "completed"
            ? <CheckCircle size={15} aria-hidden />
            : targetStatus === "not_applicable"
              ? <Prohibit size={15} aria-hidden />
              : <WarningCircle size={15} aria-hidden />}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={`training-occurrence-${row.id}-description`}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription id={`training-occurrence-${row.id}-description`}>
            {row.code} · {row.title} · {row.worksiteName}
          </DialogDescription>
        </DialogHeader>

        {targetStatus === "completed" ? (
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
            maxLength={targetStatus === "not_applicable" ? 1000 : 3000}
            placeholder={copy.observationPlaceholder}
            disabled={pending}
          />
        </Field>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <Button type="button" variant={copy.confirmVariant} onClick={submit} loading={pending}>
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
