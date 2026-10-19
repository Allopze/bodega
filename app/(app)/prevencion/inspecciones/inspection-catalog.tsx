"use client"

import * as React from "react"
import Link from "next/link"
import { ClipboardText, MagnifyingGlass } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DANO_POTENCIAL_LABELS,
  FREQUENCY_INTERVAL_DAYS, INSPECTION_FREQUENCY_LABELS, INSPECTION_KIND_LABELS,
  INSPECTION_PROVENANCE_LABELS, inspectionProgramIsOverdue, inspectionTemplateStatusLabel, nextDueAfter,
} from "@/lib/prevention/inspections"
import {
  changedPdtpAxes,
  filterPrograms,
  normalizeProgramFilters,
  numbersAccreditationNotice,
  officialSourceGate,
  pdtpSavePayload,
  programSubjectLabel,
  retireTemplateMessage,
  rollbackTemplateMessage,
  templateActionState,
  unmappedPdtpWarning,
} from "@/lib/prevention/inspection-catalog-logic"
import {
  AssigneeSelectOptions,
  findWorksiteSuggestedAssignee,
  type InspectionAssigneeOption,
} from "./assignee-picker"
import {
  approveInspectionTemplateAction,
  retireInspectionTemplateAction,
  createInspectionProgramAction,
  importInspectionTemplateAction,
  linkInspectionTemplateSourceAction,
  remindTemplateApprovalAction,
  rollbackInspectionTemplateAction,
  runProgramNowAction,
  setInspectionTemplateParityAction,
  setInspectionTemplatePdtpActivitiesAction,
  promoteUnclassifiedDeviationAction,
  setTemplateDeviationAction,
  updateInspectionProgramAction,
} from "./actions"
import { classifyPdtp2026InspectionWiring } from "@/lib/prevention/inspection-wiring"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDate, todayInChile } from "@/lib/utils"
import { REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { InspectionTemplateSelect } from "./template-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import {
  NO_SUBJECT,
  subjectIdsFromRef,
  subjectRefFromIds,
  subjectRefOf,
  templateRequiresContainer,
  type InspectionSubjectOption,
} from "@/lib/prevention/inspection-list-query"

interface Coverage {
  totalItems: number
  withDanoPotencial: number
  withRequired: number
  criticalityInert: boolean
}

export interface TemplateItem {
  id: string
  code: string
  versionLabel: string
  name: string
  kind: string
  status: string
  /** Si es `superseded` y nadie la reemplazó, fue retirada a propósito: se llama «Retirada». */
  supersededByTemplateId: string | null
  authorUserId: string
  version: number
  coverage: Coverage
  /** Actividades del PDTP (campo `n`) que acredita al completarse un run. */
  pdtpActivityNumbers: number[] | null
  /** Actividades que acredita al REVISARSE (la firma, no la ejecución). */
  pdtpReviewActivityNumbers: number[] | null
  /**
   * Lo que acredita hoy, ya resuelto con la regla del servidor (los vínculos del
   * catálogo ganan sobre los números) y con las etiquetas armadas. La tabla y el
   * diálogo leen de acá: antes cada uno leía una fuente distinta.
   */
  pdtpAccreditation: {
    source: "catalog" | "numbers" | "none"
    executeSource: "catalog" | "numbers" | "none"
    reviewSource: "catalog" | "numbers" | "none"
    execute: string[]
    review: string[]
  }
  /** Identidades con que se precarga el diálogo de acreditación, por eje. */
  pdtpPreloadExecuteIds: string[]
  pdtpPreloadReviewIds: string[]
  /** Números que acreditan por número y no tienen actividad en el catálogo corporativo. */
  pdtpUnmappedNumbers: { execute: number[]; review: number[] }
  /** Desviaciones que este instrumento ofrece al registrar, con su gravedad. */
  deviations: DeviationEntry[]
  /** Desviaciones registradas como "Otra" que aún no están en el catálogo. */
  unclassifiedDeviations: { description: string; criticality: string; occurrences: number }[]
  /** El instrumento registra desviaciones (el catálogo de desviaciones sólo tiene sentido ahí). */
  recordsDeviations: boolean
  /** Definición de `lib/sst/definitions` de la que salió el snapshot. */
  sourceDefinitionCode: string | null
  /** Quién es el ejecutante de registro (D04). */
  executorOfRecord: string
  /** El catálogo en código difiere del snapshot congelado (A-03). */
  definitionDrifted: boolean
  /** La definición de origen ya no existe en el catálogo en código. */
  definitionMissing: boolean
  provenanceKind: string
  /** Transcribe un anexo oficial: no puede aprobarse sin su planilla vinculada. */
  needsOfficialSource: boolean
  /** Checksum del archivo oficial, para ofrecer sólo el que coincide. `null` si no se conoce. */
  officialChecksumSha256: string | null
  sourceDocumentVersionId: string | null
  sourceSnapshot: { documentId: string; versionId: string; fileName: string; revision: string | null; effectiveFrom: string | null; checksumSha256: string } | null
  parityReport: { status: string; differences: string[] } | null
  contentHash: string
}

interface DocumentSourceOption {
  id: string
  documentId: string
  documentCode: string | null
  documentTitle: string
  fileName: string
  checksumSha256: string
  status: string
  effectiveFrom: string | null
}

function isOfficialProvenance(value: string) {
  return value === "official_document"
}

function parityStatusLabel(status: string | undefined) {
  if (status === "passed") return "Paridad aprobada"
  if (status === "failed") return "Con diferencias"
  return "Paridad pendiente"
}

/**
 * Una entrada del catálogo maestro, vista desde un instrumento.
 *
 * Trae el maestro entero —no sólo lo que el instrumento ofrece— porque el
 * diálogo es un selector: hay que poder marcar lo que todavía no está.
 */
export interface DeviationEntry {
  id: string
  label: string
  /** La gravedad que propone el maestro. */
  danoPotencial: string
  /** Si el maestro la tiene vigente. Retirarla ahí la apaga en todos lados. */
  isActive: boolean
  /** La criticidad que produciría con la gravedad del maestro. */
  criticality: string
  /** Si este instrumento la ofrece a quien registra en terreno. */
  selected: boolean
  /** Gravedad propia de este instrumento; null = hereda la del maestro. */
  danoPotencialOverride: string | null
  /** La que se aplica realmente al registrar acá. */
  effectiveDano: string
  effectiveCriticality: string
}

interface ProgramItem {
  id: string
  templateId: string
  worksiteId: string
  templateName: string
  worksiteName: string
  frequency: string
  intervalDays: number
  nextDueOn: string
  assignedToUserId: string | null
  assigneeName: string | null
  riskEntryId: string | null
  riskLabel: string | null
  subjectType: string | null
  /** Nombre del sujeto del inventario elegido (recurso, equipo o contenedor), si hay uno. */
  subjectLabel: string | null
  /** Sujeto del inventario; excluyente con `subjectVehicleId` (INS-04). */
  subjectResourceId: string | null
  subjectVehicleId: string | null
  subjectContainerId: string | null
  /** Define si esta programación exige contenedor del catálogo. */
  templateDefinitionCode: string | null
  isActive: boolean
  /** I-04: la plantilla puede haber quedado `superseded` desde que se creó el programa. */
  templateApproved: boolean
  version: number
}

export interface ImportableDefinition {
  code: string
  title: string
  version: string
  sections: number
  items: number
  coverage: Coverage
  /** Actividades del PDTP que acreditará al ejecutarse (cableado del programa). */
  pdtpActivities: { n: number; name: string }[]
  /** Tipo con que debe nacer: una auditoría no entra como inspección. */
  defaultKind: string
  /** Transcribe un anexo oficial: la fuente documental es obligatoria para poder aprobarla. */
  needsOfficialSource: boolean
  /** Checksum del anexo oficial, para preseleccionar en la Biblioteca el archivo que coincide. */
  officialChecksumSha256: string | null
}

export interface PdtpActivityOption { n: number; name: string; year: number }

function templateStatusVariant(status: string): "default" | "success" | "outline" {
  if (status === "approved") return "success"
  if (status === "superseded") return "outline"
  return "default"
}

function coverageLabel(coverage: Coverage) {
  return `${coverage.withDanoPotencial}/${coverage.totalItems} con gravedad`
}

/* ── Piezas comunes de los diálogos ───────────────────────────────────────── */

/**
 * Estado de un diálogo con formulario: abierto, la operación en curso y un
 * mensaje limpio cada vez que se abre. El error de un intento anterior no debe
 * esperar a quien vuelve a abrir el diálogo, que sigue montado.
 */
function useFormDialog(onOpen?: () => void) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const changeOpen = (next: boolean) => {
    operation.setMessage("")
    if (next) onOpen?.()
    setOpen(next)
  }
  return { open, changeOpen, operation }
}

type OperationMessage = Pick<ReturnType<typeof useOperation>, "message" | "messageTone">

/** El error de una operación, dentro del diálogo y anunciado como alerta. */
function OperationError({ operation }: { operation: OperationMessage }) {
  if (operation.messageTone !== "error" || !operation.message) return null
  return <Callout tone="danger" role="alert">{operation.message}</Callout>
}

/** El error de una acción que no vive en un diálogo (un botón de la fila, una casilla). */
function InlineError({ operation, className }: { operation: OperationMessage; className?: string }) {
  if (operation.messageTone !== "error" || !operation.message) return null
  return <p role="alert" className={`text-xs text-[var(--color-danger-ink)] ${className ?? ""}`}>{operation.message}</p>
}

/** «Cancelar» siempre en el pie, y el botón de confirmar con su estado de carga. */
function FormDialogFooter({ submitLabel, pending, disabled, variant, onCancel, className }: {
  submitLabel: string
  pending: boolean
  disabled?: boolean
  variant?: "primary" | "destructive"
  onCancel: () => void
  className?: string
}) {
  return (
    <DialogFooter className={className}>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Cancelar</Button>
      <Button type="submit" variant={variant} loading={pending} disabled={disabled}>{submitLabel}</Button>
    </DialogFooter>
  )
}

/**
 * El motivo de un acto que queda en el historial: obligatorio y de al menos
 * `REASON_MIN_LENGTH` caracteres, el mismo mínimo del servidor. La pista sólo
 * suma el mínimo cuando lo escrito todavía no alcanza.
 */
function ReasonField({ label = "Motivo", maxLength = 2000, error }: { label?: string; maxLength?: number; error?: string }) {
  const [length, setLength] = React.useState(0)
  const tooShort = length > 0 && length < REASON_MIN_LENGTH
  return (
    <Field label={label} required hint={tooShort ? `Queda en el historial. Mínimo ${REASON_MIN_LENGTH} caracteres.` : "Queda en el historial."} error={error}>
      <Textarea name="reason" required minLength={REASON_MIN_LENGTH} maxLength={maxLength} onChange={(event) => setLength(event.target.value.trim().length)} />
    </Field>
  )
}

/**
 * Catálogo de instrumentos. Antes convivía con la programación en una sola
 * pantalla de pestañas: son dos actos distintos —qué se pregunta y cuándo se
 * pregunta— con permisos y públicos distintos, y la pestaña obligaba a pasar
 * por uno para llegar al otro.
 */
export function InspectionTemplatesPanel({ templates, catalogActivities = [], documentSources = [], canManage, canApprove, currentUserId = null }: {
  templates: TemplateItem[]
  catalogActivities?: PdtpActivityPickerOption[]
  /** Versiones de la Biblioteca SST elegibles como fuente; sólo las trae quien administra. */
  documentSources?: DocumentSourceOption[]
  canManage: boolean
  canApprove: boolean
  /** Quien mira: la paridad la declara alguien distinto de quien incorporó la plantilla. */
  currentUserId?: string | null
}) {
  // I-16: filtros en la URL, mismo patrón que la bandeja — se perdían al refrescar.
  const { getFilter, setFilters } = useUrlFilters()
  const kind = getFilter("tipo") || "all"
  const status = getFilter("estado") || "all"
  const urlQuery = getFilter("q")
  const [query, setQueryDraft] = React.useState(urlQuery)
  React.useEffect(() => setQueryDraft(urlQuery), [urlQuery])
  React.useEffect(() => {
    const next = query.trim()
    if (next === urlQuery) return
    const timer = setTimeout(() => setFilters({ q: next || null }), 350)
    return () => clearTimeout(timer)
  }, [query, urlQuery, setFilters])
  const visibleTemplates = React.useMemo(() => templates.filter((item) => {
    const normalized = urlQuery.trim().toLocaleLowerCase("es-CL")
    return (!normalized || `${item.code} ${item.name} ${item.versionLabel}`.toLocaleLowerCase("es-CL").includes(normalized))
      && (kind === "all" || item.kind === kind)
      && (status === "all" || item.status === status)
  }), [templates, urlQuery, kind, status])

  /**
   * El estado del cableado, con la misma función que usa el preflight del
   * despliegue. Compartirla es el punto: una pantalla que opine distinto del
   * informe del deploy es peor que no tener pantalla.
   */
  const wiring = React.useMemo(() => classifyPdtp2026InspectionWiring(templates.map((item) => ({
    id: item.id,
    code: item.code,
    versionLabel: item.versionLabel,
    status: item.status,
    sourceDefinitionCode: item.sourceDefinitionCode,
    pdtpActivityNumbers: item.pdtpActivityNumbers,
    executorOfRecord: item.executorOfRecord,
  }))), [templates])

  /** Por plantilla vigente mal cableada: qué declara el borrador que la espera. */
  const silentlyUnwiredById = React.useMemo(() => {
    const map = new Map<string, { declares: number[]; draftVersionLabel: string }>()
    for (const gap of wiring.gaps) {
      if (gap.kind !== "silently_unwired") continue
      map.set(gap.approved.id, { declares: gap.draft.declares, draftVersionLabel: gap.draft.versionLabel })
    }
    return map
  }, [wiring])

  /** Vigentes cuyo reemplazo cambió de código: aprobar el borrador no las retira. */
  const orphanApprovedById = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const gap of wiring.gaps) {
      if (gap.kind !== "orphan_approved") continue
      map.set(gap.approved.id, gap.replacedByCodes)
    }
    return map
  }, [wiring])

  const pendingApprovalCount = wiring.gaps.filter((gap) => gap.kind === "pending_approval").length
  const silentCount = silentlyUnwiredById.size + orphanApprovedById.size

  const actionProps = { templates, catalogActivities, documentSources, canManage, canApprove, currentUserId }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem_12rem]">
        <div className="relative">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input value={query} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Buscar código o nombre" aria-label="Buscar plantillas" className="pl-9" />
        </div>
        <Select value={kind} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar plantillas por tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar plantillas por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="draft">Borradores</SelectItem><SelectItem value="approved">Aprobadas</SelectItem><SelectItem value="superseded">Reemplazadas o retiradas</SelectItem></SelectContent></Select>
      </div>

      {silentCount > 0 && (
        <Callout
          tone="danger"
          title={`${silentCount === 1 ? "Un instrumento vigente no acredita" : `${silentCount} instrumentos vigentes no acreditan`} en el programa anual.`}
        >
          <span className="text-xs">
            Se pueden ejecutar y cerrar con normalidad, y el PDTP no se entera. Su borrador sí declara la actividad: aprobarlo lo corrige.
          </span>
        </Callout>
      )}
      {pendingApprovalCount > 0 && (
        <Callout tone="warning">
          <p>
            {pendingApprovalCount === 1
              ? "Un instrumento del programa 2026 está en borrador."
              : `${pendingApprovalCount} instrumentos del programa 2026 están en borrador.`}{" "}
            Mientras no se aprueben, sus actividades del PDTP no acreditan.
          </p>
          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => setFilters({ estado: "draft" })}>
            Ver borradores
          </Button>
        </Callout>
      )}
      {visibleTemplates.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={templates.length === 0 ? "No hay instrumentos incorporados" : "No hay plantillas con estos filtros"}
          description={templates.length === 0 ? "Una persona administradora debe incorporar un instrumento desde el catálogo SST y luego enviarlo a aprobación." : "Ajusta la búsqueda, el tipo o el estado."}
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {visibleTemplates.map((item) => (
            <article key={item.id} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div><span className="font-mono text-xs text-[var(--color-text-subtle)]">{item.code} · {item.versionLabel}</span><h2 className="mt-0.5 text-sm font-semibold">{item.name}</h2><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{INSPECTION_KIND_LABELS[item.kind] ?? item.kind}</p></div>
                <div className="flex flex-col items-end gap-1">
                  <TemplateStatusBadge item={item} />
                  {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
                  {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} />}
                </div>
              </div>
              {item.definitionMissing && <Callout tone="warning" className="text-xs">La fuente fue retirada del catálogo, pero esta versión {item.status === "approved" ? "sigue ejecutable desde su checklist congelado hasta que la retires" : "se conserva sólo como historial"}.</Callout>}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {/* I-29: la fracción no se explicaba por sí sola. */}
                <div><dt className="text-[var(--color-text-subtle)]" title="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos.">Gravedad declarada</dt><dd className="mt-0.5 font-medium">{coverageLabel(item.coverage)}</dd></div>
                <div><dt className="text-[var(--color-text-subtle)]">PDTP</dt><dd className="mt-0.5 font-medium"><PdtpAccreditationSummary item={item} silentlyUnwired={silentlyUnwiredById.get(item.id)} orphanReplacedBy={orphanApprovedById.get(item.id)} /></dd></div>
                <div className="col-span-2"><dt className="text-[var(--color-text-subtle)]">Fuente y paridad</dt><dd className="mt-0.5 font-medium">{item.sourceSnapshot ? <><a className="underline" href={`/api/prevencion/documentacion/${item.sourceSnapshot.documentId}/version/${item.sourceSnapshot.versionId}`}>{item.sourceSnapshot.fileName}</a> · {item.sourceSnapshot.revision ?? "sin revisión"} · {parityStatusLabel(item.parityReport?.status)}{item.parityReport?.status === "failed" && (item.parityReport.differences?.length ?? 0) > 0 && (
                  <ul className="mt-0.5 list-disc pl-4 font-normal text-[var(--color-warning-ink)]">
                    {item.parityReport.differences.map((difference) => <li key={difference}>{difference}</li>)}
                  </ul>
                )}</> : isOfficialProvenance(item.provenanceKind) ? "Documento oficial pendiente" : INSPECTION_PROVENANCE_LABELS.platform_definition}</dd></div>
              </dl>
              <TemplateActions item={item} {...actionProps} />
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Fuente / paridad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Gravedad declarada</TableHead>
                <TableHead>Acredita PDTP</TableHead>
                <TableHead>Desviaciones</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTemplates.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.name}</span>
                    {/* I-28: la plantilla demo (y cualquier otra sin origen de catálogo) quedaba indistinguible de un instrumento real. */}
                    {!item.sourceDefinitionCode && <MetaBadge meta={{ label: "Sin origen en catálogo", variant: "outline" }} className="mt-1" />}
                  </TableCell>
                  <TableCell className="text-sm">{INSPECTION_KIND_LABELS[item.kind] ?? item.kind}</TableCell>
                  <TableCell className="font-mono text-xs">{item.versionLabel}</TableCell>
                  <TableCell className="max-w-64 text-xs">
                    {item.sourceSnapshot ? <>
                      <a className="underline" href={`/api/prevencion/documentacion/${item.sourceSnapshot.documentId}/version/${item.sourceSnapshot.versionId}`}>{item.sourceSnapshot.fileName}</a>
                      <span className="block">{item.sourceSnapshot.revision ?? "Sin revisión"} · {parityStatusLabel(item.parityReport?.status)}</span>
                      {/* Las diferencias se guardaban y no se mostraban en ninguna
                          parte: una plantilla con veinte decía sólo «Con diferencias». */}
                      {item.parityReport?.status === "failed" && (item.parityReport.differences?.length ?? 0) > 0 && (
                        <ul className="mt-0.5 list-disc pl-4 text-[var(--color-warning-ink)]">
                          {item.parityReport.differences.map((difference) => <li key={difference}>{difference}</li>)}
                        </ul>
                      )}
                      <span className="block font-mono" title={item.sourceSnapshot.checksumSha256}>SHA-256 {item.sourceSnapshot.checksumSha256.slice(0, 12)}…</span>
                      <span className="block font-mono" title={item.contentHash}>JSON {item.contentHash.slice(0, 12)}…</span>
                    </> : isOfficialProvenance(item.provenanceKind) ? <span className="text-[var(--color-warning-ink)]">Documento oficial pendiente</span> : INSPECTION_PROVENANCE_LABELS.platform_definition}
                  </TableCell>
                  <TableCell>
                    <TemplateStatusBadge item={item} />
                    {/* A-03: el snapshot está congelado a propósito, así que la
                        deriva no es un error — es la señal de que toca publicar
                        una versión nueva. Sólo interesa mientras la plantilla
                        esté vigente; una ya reemplazada deriva por definición. */}
                    {item.status !== "superseded" && item.definitionDrifted && (
                      <span className="mt-1 block text-xs text-[var(--color-warning-ink)]" title="El contenido en código difiere del snapshot aprobado. No implica que el checklist haya cambiado de fondo.">
                        Catálogo actualizado
                      </span>
                    )}
                    {item.definitionMissing && (
                      <span className="mt-1 block max-w-48 text-xs text-[var(--color-warning-ink)]" title="La fuente fue retirada; el snapshot de esta versión se conserva.">
                        Fuente retirada · {item.status === "approved" ? "sigue ejecutable desde su checklist congelado" : "sólo historial"}
                      </span>
                    )}
                  </TableCell>
                  {/* I-29: la fracción no se explicaba por sí sola. */}
                  <TableCell className="text-sm" title="Ítems con gravedad asignada; el resto usa una gravedad por defecto al generar hallazgos.">
                    {coverageLabel(item.coverage)}
                    {item.coverage.criticalityInert && <span className="ml-1 text-xs text-[var(--color-warning-ink)]">sin gravedad: toda falla saldrá de criticidad media</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <PdtpAccreditationSummary item={item} silentlyUnwired={silentlyUnwiredById.get(item.id)} orphanReplacedBy={orphanApprovedById.get(item.id)} />
                  </TableCell>
                  {/* El catálogo de desviaciones sólo tiene sentido en los
                      instrumentos que no puntúan ítems: ahí la gravedad no la
                      declara ningún ítem y tiene que declararla el catálogo. */}
                  <TableCell className="text-sm">
                    <DeviationsCell item={item} canManage={canManage} />
                  </TableCell>
                  <TableCell className="text-right">
                    <TemplateActions item={item} {...actionProps} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}

/** «Retirada» es un `superseded` que nadie reemplazó: «Reemplazada» afirmaba una versión nueva que no existe. */
function TemplateStatusBadge({ item }: { item: TemplateItem }) {
  return <MetaBadge meta={{ label: inspectionTemplateStatusLabel(item.status, item.supersededByTemplateId), variant: templateStatusVariant(item.status) }} />
}

/**
 * Qué acredita la plantilla en el programa anual, desde `pdtpAccreditation` (la
 * misma lectura que edita el diálogo). Tres casos distintos que antes se pintaban
 * igual:
 * - un borrador imprimía sus actividades como si ya rigieran;
 * - una vigente sin actividades por estar mal cableada se leía igual que la
 *   auditoría del SGSST, que legítimamente no acredita ninguna;
 * - una versión reemplazada o retirada ya no acredita.
 */
function PdtpAccreditationSummary({ item, silentlyUnwired, orphanReplacedBy }: {
  item: TemplateItem
  silentlyUnwired?: { declares: number[]; draftVersionLabel: string }
  orphanReplacedBy?: string[]
}) {
  const { execute, review, executeSource } = item.pdtpAccreditation
  const byNumber = executeSource === "numbers"
    ? "Acredita por número de actividad; edita la acreditación para vincularla al catálogo."
    : undefined
  return (
    <>
      {execute.length > 0 ? (
        <span
          className={item.status === "approved" ? "font-mono text-xs" : "text-xs text-[var(--color-text-subtle)]"}
          title={byNumber}
        >
          {item.status === "approved"
            ? execute.join(", ")
            : item.status === "draft"
              ? `Acreditará ${execute.join(", ")} al aprobarse`
              : `Acreditaba ${execute.join(", ")}`}
        </span>
      ) : silentlyUnwired ? (
        <span className="text-xs text-[var(--color-danger-ink)]">
          No acredita · el borrador v{silentlyUnwired.draftVersionLabel} declara{" "}
          {silentlyUnwired.declares.map((n) => `N° ${n}`).join(", ")}
        </span>
      ) : orphanReplacedBy ? (
        <span className="text-xs text-[var(--color-danger-ink)]">
          No acredita · reemplazada por {orphanReplacedBy.join(" y ")}, retírala a mano
        </span>
      ) : (
        <span className="text-xs text-[var(--color-text-subtle)]">No acredita</span>
      )}
      {/* Al revisar es otra ocurrencia y otro responsable: la
          n=25 la ejecuta el operador, la n=26 la firma el Sup/JT. */}
      {review.length > 0 && (
        <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">
          al revisar: <span className="font-mono">{review.join(", ")}</span>
        </span>
      )}
    </>
  )
}

/**
 * El catálogo de desviaciones sólo existe en los instrumentos que las registran
 * y sólo lo administra quien puede gestionar plantillas. En el resto no hay
 * nada que mostrar: «Ninguna ofrecida» sugería un catálogo vacío que arreglar.
 */
function DeviationsCell({ item, canManage }: { item: TemplateItem; canManage: boolean }) {
  if (!item.recordsDeviations || !canManage) {
    return (
      <span
        className="text-xs text-[var(--color-text-subtle)]"
        title={item.recordsDeviations ? "Sólo quien administra las plantillas ve y ajusta las desviaciones." : "Este instrumento no registra desviaciones."}
      >
        No aplica
      </span>
    )
  }
  const offered = item.deviations.filter((entry) => entry.selected).length
  return (
    <>
      {offered > 0
        ? `${offered} ofrecida(s)`
        : <span className="text-xs text-[var(--color-text-subtle)]">Ninguna ofrecida</span>}
      {item.unclassifiedDeviations.length > 0 && (
        <span className="mt-1 block text-xs text-[var(--color-warning-ink)]">
          {item.unclassifiedDeviations.length} por clasificar
        </span>
      )}
    </>
  )
}

/**
 * I-15: quien incorpora un borrador (`manage`) puede no tener `approve` — sin
 * esto podía crear una plantilla que nunca podría habilitar ella misma, sin
 * forma de avisarle a quien sí puede.
 */
function RequestApprovalButton({ templateId }: { templateId: string }) {
  const operation = useOperation()
  return (
    <div className="text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={operation.pending}
        onClick={() => operation.run(
          () => remindTemplateApprovalAction({ templateId }),
          (result) => {
            const names = result.data?.notified
            toast.success(Array.isArray(names) && names.length > 0 ? `Solicitud enviada a ${names.join(", ")}.` : "Solicitud de aprobación enviada.")
          },
        )}
      >
        {operation.pending ? "Enviando…" : "Solicitar aprobación"}
      </Button>
      <InlineError operation={operation} className="max-w-64" />
    </div>
  )
}

function TemplateActions({ item, templates, catalogActivities, documentSources, canManage, canApprove, currentUserId }: {
  item: TemplateItem
  templates: TemplateItem[]
  catalogActivities: PdtpActivityPickerOption[]
  documentSources: DocumentSourceOption[]
  canManage: boolean
  canApprove: boolean
  currentUserId: string | null
}) {
  // La versión a la que se puede volver es la que ESTA reemplazó al aprobarse.
  // Una versión retirada a propósito no apunta a nada y no se restaura.
  const previous = templates.find((candidate) => candidate.supersededByTemplateId === item.id)
  // Lo que el servidor rechazaría no se ofrece como botón: se dice por qué todavía
  // no (patrón I-04; un botón deshabilitado no avisa por teclado ni en móvil).
  const state = templateActionState(item, { canManage, canApprove, currentUserId })
  return (
    <div className="flex flex-col items-end gap-2">
      {state.notice && <p className="max-w-64 text-right text-xs text-[var(--color-warning-ink)]">{state.notice}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {state.deviations && <DeviationCatalogDialog templateCode={item.code} name={item.name} entries={item.deviations} unclassified={item.unclassifiedDeviations} />}
        {state.pdtp && <PdtpActivitiesDialog item={item} options={catalogActivities} />}
        {state.linkSource && <LinkSourceDialog item={item} documentSources={documentSources} label={state.linkSource} />}
        {state.declareParity && <ParityDialog item={item} />}
        {state.approve && <ApproveDialog templateId={item.id} name={item.name} expectedVersion={item.version} />}
        {state.requestApproval && <RequestApprovalButton templateId={item.id} />}
        {state.retire && <RetireDialog templateId={item.id} name={item.name} />}
        {item.status === "approved" && previous && canApprove && <RollbackTemplateDialog current={item} previous={previous} />}
      </div>
    </div>
  )
}

/**
 * Declara si la transcripción digital coincide con la planilla oficial.
 *
 * Antes esto se afirmaba con una casilla en el diálogo de importación que
 * comparaba la definición consigo misma y sólo sabía decir «sí». Quien no la
 * marcaba dejaba la plantilla en `pending`, y nada podía sacarla de ahí. Acá se
 * declara contra el documento ya vinculado, se pueden enumerar las diferencias,
 * y queda la traza de quién lo hizo.
 */
function ParityDialog({ item }: { item: TemplateItem }) {
  const initialStatus = item.parityReport?.status === "failed" ? "failed" : "passed"
  const [status, setStatus] = React.useState<"passed" | "failed">(initialStatus)
  // Al abrir se parte de la paridad guardada, no de una elección abandonada.
  const { open, changeOpen, operation } = useFormDialog(() => setStatus(initialStatus))
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Declarar paridad</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const toCount = (name: string) => {
        const raw = String(form.get(name) ?? "").trim()
        return raw === "" ? null : Number(raw)
      }
      const differences = String(form.get("differences") ?? "")
        .split("\n").map((line) => line.trim()).filter(Boolean)
      operation.run(() => setInspectionTemplateParityAction({
        templateId: item.id,
        expectedVersion: item.version,
        status,
        expectedItems: toCount("expectedItems"),
        actualItems: toCount("actualItems"),
        differences: status === "failed" ? differences : [],
        reason: String(form.get("reason") ?? ""),
      }), () => {
        toast.success(status === "passed" ? "Paridad declarada: sin diferencias." : "Paridad declarada con diferencias.")
        changeOpen(false)
      })
    }}>
      <DialogHeader>
        <DialogTitle>Paridad de {item.name}</DialogTitle>
        <DialogDescription>
          Contrasta la definición digital con {item.sourceSnapshot?.fileName ?? "el anexo vinculado"}. Sin paridad aprobada el instrumento no puede habilitarse.
        </DialogDescription>
      </DialogHeader>
      <Field label="Resultado" required>
        <Select value={status} onValueChange={(value) => setStatus(value as "passed" | "failed")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="passed">Coincide, sin diferencias</SelectItem>
            <SelectItem value="failed">Tiene diferencias</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ítems del anexo" error={operation.fieldError("expectedItems")}><Input name="expectedItems" type="number" min={0} inputMode="numeric" /></Field>
        <Field label="Ítems transcritos" error={operation.fieldError("actualItems")}><Input name="actualItems" type="number" min={0} inputMode="numeric" /></Field>
      </div>
      {status === "failed" && (
        <Field label="Diferencias, una por línea" required error={operation.fieldError("differences")}>
          <Textarea name="differences" required rows={4} placeholder={"Falta el ítem «Estado del cinturón»\nLa columna N/A no existe en el anexo"} />
        </Field>
      )}
      <ReasonField maxLength={3000} error={operation.fieldError("reason")} />
      <OperationError operation={operation} />
      <FormDialogFooter submitLabel="Guardar paridad" pending={operation.pending} onCancel={() => changeOpen(false)} />
    </form></DialogContent>
  </Dialog>
}

/**
 * Vincula —o cambia— la planilla oficial de un borrador.
 *
 * Sin esto un anexo oficial incorporado sin su archivo no podía aprobarse
 * nunca: aprobar exige la fuente y la paridad, y lo único posible era retirarlo
 * y volver a incorporarlo. Con el checksum conocido sólo se ofrece el archivo
 * que coincide (el servidor rechaza los demás) y viene elegido.
 */
function LinkSourceDialog({ item, documentSources, label }: {
  item: TemplateItem
  documentSources: DocumentSourceOption[]
  label: "Vincular fuente" | "Cambiar fuente"
}) {
  const base = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: item.officialChecksumSha256, sources: documentSources, selectedId: "" })
  const initialSourceId = base.preselectedId || item.sourceDocumentVersionId || ""
  const [sourceId, setSourceId] = React.useState(initialSourceId)
  const { open, changeOpen, operation } = useFormDialog(() => setSourceId(initialSourceId))
  const gate = officialSourceGate({ needsOfficialSource: true, officialChecksumSha256: item.officialChecksumSha256, sources: documentSources, selectedId: sourceId })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const revision = String(new FormData(event.currentTarget).get("sourceRevision") ?? "").trim()
    operation.run(() => linkInspectionTemplateSourceAction({
      templateId: item.id,
      expectedVersion: item.version,
      sourceDocumentVersionId: sourceId,
      sourceRevision: revision || undefined,
    }), () => {
      toast.success("Planilla oficial vinculada. La paridad quedó pendiente.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">{label}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Vincular planilla oficial · {item.name}</DialogTitle>
            <DialogDescription>La paridad se declara contra este archivo. Cambiarlo deja la paridad pendiente otra vez.</DialogDescription>
          </DialogHeader>
          <Field label="Fuente documental de la Biblioteca SST" required error={operation.fieldError("sourceDocumentVersionId")}>
            <Combobox
              id={`link-source-${item.id}`}
              options={gate.candidates.map((source) => ({
                value: source.id,
                label: source.documentCode ?? source.documentTitle,
                hint: source.fileName,
              }))}
              value={sourceId}
              onChange={setSourceId}
              placeholder="Buscar por código o nombre de archivo…"
              aria-label="Fuente documental de la Biblioteca SST"
            />
          </Field>
          {gate.noMatch && (
            <Callout tone="warning">
              No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial. Súbela en{" "}
              <Link href="/prevencion/documentacion" className="underline">Documentación</Link> y vuelve a vincularla.
            </Callout>
          )}
          <Field label="Revisión impresa" hint="Opcional." error={operation.fieldError("sourceRevision")}>
            <Input name="sourceRevision" placeholder="Ej. Rev. 02" maxLength={120} />
          </Field>
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Vincular" pending={operation.pending} disabled={sourceId === ""} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RollbackTemplateDialog({ current, previous }: { current: TemplateItem; previous: TemplateItem }) {
  const { open, changeOpen, operation } = useFormDialog()
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary">Revertir versión</Button></DialogTrigger>
    <DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
      operation.run(() => rollbackInspectionTemplateAction({ currentTemplateId: current.id, previousTemplateId: previous.id, reason }), (result) => {
        toast.success(rollbackTemplateMessage(previous.versionLabel, result.data))
        changeOpen(false)
      })
    }}>
      <DialogHeader><DialogTitle>Volver a {previous.versionLabel}</DialogTitle><DialogDescription>Programas y ejecuciones todavía planificadas volverán a la versión anterior. Las iniciadas o cerradas conservarán {current.versionLabel}.</DialogDescription></DialogHeader>
      <ReasonField label="Motivo de la reversión" error={operation.fieldError("reason")} />
      <OperationError operation={operation} />
      <FormDialogFooter submitLabel="Confirmar reversión" pending={operation.pending} onCancel={() => changeOpen(false)} />
    </form></DialogContent>
  </Dialog>
}

/**
 * Programación: qué instrumento se ejecuta, en qué faena y con qué frecuencia.
 * El cron diario materializa desde acá, y "Ejecutar ahora" usa el mismo camino.
 */
export function InspectionProgramsPanel({
  programs, assignees, subjectsByWorksite = {}, riskEntriesByWorksite = {}, canManage, emptyAction, emptyDescription,
}: {
  programs: ProgramItem[]
  assignees: InspectionAssigneeOption[]
  /** Inventario por faena, para declarar QUÉ se inspecciona (INS-04). */
  subjectsByWorksite?: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite?: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  canManage: boolean
  /** La acción real del estado vacío (A4): crear la primera programación, o ir a donde se arregla lo que falta. */
  emptyAction?: React.ReactNode
  /** Reemplaza la explicación del estado vacío cuando lo que falta es otra cosa (p. ej. una plantilla aprobada). */
  emptyDescription?: string
}) {
  // I-16: filtros en la URL, mismo patrón que la bandeja — sólo `vista` sobrevivía al refresh.
  const { getFilter, setFilters } = useUrlFilters()
  const today = todayInChile()
  // «Vencidas» es una vista, no un estado: un mismo concepto en dos controles
  // dejaba combinaciones imposibles (`estado=paused&vista=vencidas`, siempre vacía).
  const { status, overdueView } = normalizeProgramFilters({ estado: getFilter("estado"), vista: getFilter("vista") })
  const worksite = getFilter("faena") || "all"
  const urlQuery = getFilter("q")
  const [query, setQueryDraft] = React.useState(urlQuery)
  React.useEffect(() => setQueryDraft(urlQuery), [urlQuery])
  React.useEffect(() => {
    const next = query.trim()
    if (next === urlQuery) return
    const timer = setTimeout(() => setFilters({ q: next || null }), 350)
    return () => clearTimeout(timer)
  }, [query, urlQuery, setFilters])
  const worksites = React.useMemo(() => Array.from(
    new Map(programs.map((item) => [item.worksiteId, item.worksiteName])).entries(),
  ).map(([id, name]) => ({ id, name })), [programs])
  const visiblePrograms = React.useMemo(
    () => filterPrograms(programs, { query: urlQuery, status, worksite, overdueView, today }),
    [programs, urlQuery, status, worksite, overdueView, today],
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_12rem_12rem_auto]">
        <div className="relative">
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <Input value={query} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Buscar plantilla, sujeto o riesgo" aria-label="Buscar programaciones" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(value) => setFilters({ estado: value === "all" ? null : value, vista: null })}><SelectTrigger aria-label="Filtrar programaciones por estado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="active">Activas</SelectItem><SelectItem value="paused">Detenidas</SelectItem></SelectContent></Select>
        <Select value={worksite} onValueChange={(value) => setFilters({ faena: value === "all" ? null : value })}><SelectTrigger aria-label="Filtrar programaciones por faena"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
        <Button
          type="button"
          size="sm"
          variant={overdueView ? "primary" : "secondary"}
          aria-pressed={overdueView}
          onClick={() => setFilters({ vista: overdueView ? null : "vencidas", estado: null })}
        >
          {overdueView ? "Ver todas" : "Sólo vencidas"}
        </Button>
      </div>
      <p className="text-eyebrow">{visiblePrograms.length} {visiblePrograms.length === 1 ? "programación" : "programaciones"}</p>

      {visiblePrograms.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={programs.length === 0 ? "Aún no hay programación" : overdueView ? "No hay programaciones vencidas" : "No hay programaciones con estos filtros"}
          description={programs.length === 0
            ? emptyDescription ?? (canManage
              ? "Una programación crea sola la inspección de cada período, con el instrumento y la faena que elijas."
              : "Todavía no se programó ninguna inspección. Quien administra las inspecciones puede crearlas.")
            : overdueView ? "Todas las programaciones activas tienen su próxima fecha al día." : "Ajusta la búsqueda, el estado o la faena."}
          action={programs.length === 0
            ? emptyAction
            : overdueView
              ? <Button type="button" variant="secondary" onClick={() => setFilters({ vista: null, estado: null })}>Ver todas</Button>
              : <Button type="button" variant="secondary" onClick={() => setFilters({ q: null, estado: null, faena: null, vista: null })}>Limpiar filtros</Button>}
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {visiblePrograms.map((item) => {
            const overdue = inspectionProgramIsOverdue(item, today)
            return (
              <article key={item.id} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="text-sm font-semibold">{item.templateName}</h2><p className="mt-1 text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</p></div>
                  <MetaBadge meta={{ label: `${!item.templateApproved ? "Plantilla reemplazada" : !item.isActive ? "Detenida" : overdue ? "Vencida" : "Activa"}`, variant: !item.templateApproved ? "warning" : !item.isActive ? "outline" : overdue ? "warning" : "success" }} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-[var(--color-text-subtle)]">Cadencia</dt><dd className="mt-0.5 font-medium">{INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency} · {item.intervalDays} días</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Próxima</dt><dd className="mt-0.5 font-medium tabular-nums">{formatDate(item.nextDueOn)}</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Asignada a</dt><dd className="mt-0.5 font-medium">{item.assigneeName ?? "Sin asignar"}</dd></div>
                  <div><dt className="text-[var(--color-text-subtle)]">Sujeto</dt><dd className="mt-0.5 font-medium">{programSubjectLabel(item)}</dd></div>
                </dl>
                {item.riskLabel && <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs"><span className="text-[var(--color-text-subtle)]">Riesgo MIPER:</span> {item.riskLabel}</p>}
                {canManage && <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} />}
              </article>
            )
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Frecuencia</TableHead>
                <TableHead>Próxima</TableHead>
                <TableHead>Asignada a</TableHead>
                <TableHead>Contexto</TableHead>
                <TableHead>Activa</TableHead>
                {canManage && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePrograms.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.templateName}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell className="text-sm">
                    {INSPECTION_FREQUENCY_LABELS[item.frequency] ?? item.frequency}
                    <span className="block text-xs text-[var(--color-text-subtle)]">cada {item.intervalDays} {item.intervalDays === 1 ? "día" : "días"}</span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {formatDate(item.nextDueOn)}
                    {inspectionProgramIsOverdue(item, today) && (
                      <span className="block text-xs text-[var(--color-warning-ink)]">Vencida</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.assigneeName ?? "Sin asignar"}</TableCell>
                  <TableCell className="max-w-64 text-sm">
                    <span>{programSubjectLabel(item)}</span>
                    {item.riskLabel && <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">MIPER · {item.riskLabel}</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {!item.templateApproved
                      ? <MetaBadge meta={{ label: "Plantilla reemplazada", variant: "warning" }} />
                      : item.isActive ? "Sí" : "No"}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <ProgramActions program={item} assignees={assignees} subjectsByWorksite={subjectsByWorksite} riskEntriesByWorksite={riskEntriesByWorksite} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}

function ProgramActions({ program, assignees, subjectsByWorksite, riskEntriesByWorksite }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjectsByWorksite: Record<string, InspectionSubjectOption[]>
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <EditProgramDialog
        program={program}
        assignees={assignees}
        subjects={subjectsByWorksite[program.worksiteId] ?? []}
        riskEntries={riskEntriesByWorksite[program.worksiteId] ?? []}
      />
      <ToggleProgramButton program={program} />
      {program.isActive && (program.templateApproved
        ? <RunProgramNowButton program={program} />
        // I-04: un botón deshabilitado no avisa de forma fiable por teclado/
        // lector de pantalla ni en móvil (sin hover); el texto siempre visible
        // dice lo mismo en ambos casos, sin JS.
        : <p className="max-w-64 text-right text-xs text-[var(--color-warning-ink)]">
            No producirá inspecciones: su plantilla ya no está aprobada. Detén este programa y crea uno nuevo apuntando a una plantilla vigente.
          </p>)}
    </div>
  )
}

/* ── Creador de desviaciones ──────────────────────────────────────────────── */

/** La gravedad que corresponde a una criticidad ya registrada, para sugerirla. */
const DANO_BY_CRITICALITY: Record<string, string> = {
  low: "leve",
  medium: "moderado",
  high: "grave",
  critical: "fatal",
}

const DANO_LABELS: Record<string, string> = {
  leve: "Leve → hallazgo bajo · 30 días",
  moderado: "Moderado → hallazgo medio · 15 días",
  grave: "Grave → hallazgo alto · 7 días",
  fatal: "Fatal → hallazgo crítico · 3 días y detención",
}

/**
 * Elige qué desviaciones del catálogo maestro ofrece este instrumento.
 *
 * Es lo que permite que quien registra en terreno NO decida la gravedad: elige
 * de esta lista y el plazo de la acción correctiva sale solo. La única excepción
 * es "Otra desviación", donde sí la elige — y esas aparecen acá abajo para que
 * Prevención las incorpore y dejen de depender de un criterio individual.
 *
 * La lista en sí se mantiene en Administración; acá sólo se marca cuáles
 * aplican y, si hace falta, se ajusta la gravedad para este instrumento. La
 * selección cuelga del CÓDIGO del instrumento, así que versionarlo no la pierde.
 */
function DeviationCatalogDialog({ templateCode, name, entries, unclassified }: {
  templateCode: string
  name: string
  entries: DeviationEntry[]
  unclassified: { description: string; criticality: string; occurrences: number }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle))
  }, [entries, query])
  // Lo ofrecido primero: es lo que se viene a revisar, y con un maestro largo
  // quedaba disperso entre decenas de casillas vacías.
  const ordered = React.useMemo(
    () => [...visible].sort((a, b) => Number(b.selected) - Number(a.selected) || a.label.localeCompare(b.label)),
    [visible],
  )
  const offered = entries.filter((entry) => entry.selected).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Desviaciones{unclassified.length > 0 ? ` (${unclassified.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desviaciones · {name}</DialogTitle>
          <DialogDescription>
            Lo que este instrumento ofrece al registrar una desviación, con la gravedad que le corresponde. Quien
            registra en terreno elige de esta lista; el plazo de la acción correctiva sale de acá y no de su criterio.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar desviación…"
            aria-label="Buscar en el catálogo maestro"
            className="h-8 text-sm"
          />
          <span className="shrink-0 text-xs text-[var(--color-text-subtle)]">{offered} ofrecida(s)</span>
        </div>

        {ordered.length > 0 ? (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {ordered.map((entry) => (
              <DeviationRow key={entry.id} templateCode={templateCode} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-subtle)]">
            {entries.length === 0
              ? "El catálogo maestro está vacío. Se arma en Administración → Desviaciones."
              : "Ninguna desviación coincide con la búsqueda."}
          </p>
        )}

        {unclassified.length > 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
            <p className="font-medium">Registradas como «Otra», sin catalogar</p>
            <p className="mt-1 text-[var(--color-text-subtle)]">
              Su gravedad la eligió quien registró. Incorpóralas al maestro y dejarán de depender de un criterio
              individual.
            </p>
            <ul className="mt-2 space-y-1">
              {unclassified.slice(0, 12).map((item) => (
                <UnclassifiedRow key={item.description} templateCode={templateCode} item={item} />
              ))}
            </ul>
            {unclassified.length > 12 && <p className="mt-1">…y {unclassified.length - 12} más.</p>}
          </div>
        )}

        <p className="text-xs text-[var(--color-text-subtle)]">
          La lista maestra —crear, redactar y retirar desviaciones— se mantiene en{" "}
          <Link href="/admin/desviaciones" className="underline">Administración → Desviaciones</Link>.
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** Una desviación del maestro con su casilla y su gravedad en este instrumento. */
function DeviationRow({ templateCode, entry }: { templateCode: string; entry: DeviationEntry }) {
  const operation = useOperation()
  const retirada = !entry.isActive

  return (
    <div className="rounded border border-[var(--color-border)] px-2 py-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Checkbox
          className="min-w-0"
          checked={entry.selected}
          disabled={operation.pending || retirada}
          onChange={(event) => operation.run(() => setTemplateDeviationAction({
            templateCode,
            entryId: entry.id,
            selected: event.target.checked,
            danoPotencialOverride: entry.danoPotencialOverride,
          }))}
          label={
            <span className={retirada ? "text-[var(--color-text-subtle)] line-through" : undefined}>
              {entry.label}
            </span>
          }
        />
        <span className="flex shrink-0 items-center gap-2">
          {/* Recalibrar acá no reescribe los hallazgos ya levantados: su
              criticidad es evidencia del plazo que tuvieron. */}
          <Select
            value={entry.effectiveDano}
            disabled={!entry.selected || operation.pending}
            onValueChange={(value) => operation.run(() => setTemplateDeviationAction({
              templateCode,
              entryId: entry.id,
              selected: true,
              // Volver al valor del maestro borra el ajuste en vez de fijarlo:
              // así la entrada sigue heredando futuras recalibraciones.
              danoPotencialOverride: value === entry.danoPotencial ? null : value,
            }))}
          >
            <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Gravedad de ${entry.label}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {/* La consecuencia va en la etiqueta: acá salía "grave" pelado,
                  para la misma decisión. */}
              {Object.entries(DANO_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          {entry.danoPotencialOverride && (
            <span className="text-xs text-[var(--color-warning-ink)]" title={`El maestro propone ${DANO_POTENCIAL_LABELS[entry.danoPotencial] ?? entry.danoPotencial}`}>
              ajustada
            </span>
          )}
          {retirada && <span className="text-xs text-[var(--color-text-subtle)]">retirada del maestro</span>}
        </span>
      </div>
      {/* Si la acción falla la casilla vuelve a su estado: sin esto no había
          forma de saber por qué. */}
      <InlineError operation={operation} className="mt-1" />
    </div>
  )
}

/** Una desviación fuera de catálogo, con el botón que la incorpora al maestro. */
function UnclassifiedRow({ templateCode, item }: {
  templateCode: string
  item: { description: string; criticality: string; occurrences: number }
}) {
  const operation = useOperation()
  const [dano, setDano] = React.useState(DANO_BY_CRITICALITY[item.criticality] ?? "moderado")

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 flex-1">
        {item.description}
        {item.occurrences > 1 ? ` · ${item.occurrences} veces` : ""}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Select value={dano} onValueChange={setDano}>
          <SelectTrigger className="h-7 w-52 text-xs" aria-label={`Gravedad oficial de ${item.description}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(DANO_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={operation.pending}
          onClick={() => operation.run(() => promoteUnclassifiedDeviationAction({
            templateCode,
            label: item.description,
            danoPotencial: dano,
          }), () => toast.success("Desviación incorporada al maestro."))}
        >
          Incorporar
        </Button>
      </span>
      <InlineError operation={operation} className="w-full" />
    </li>
  )
}

/* ── Incorporar plantilla ─────────────────────────────────────────────────── */

/** Centinela de "sin actividad": `Select` reserva el string vacío. */
const NO_ACTIVITY = "__none__"

export function ImportTemplateDialog({ importable, templates, documentSources }: {
  importable: ImportableDefinition[]
  templates: TemplateItem[]
  documentSources: DocumentSourceOption[]
}) {
  const versionsByDefinition = React.useMemo(() => {
    const map = new Map<string, { approved?: TemplateItem; latest?: TemplateItem }>()
    for (const template of templates) {
      if (!template.sourceDefinitionCode) continue
      const entry = map.get(template.sourceDefinitionCode) ?? {}
      if (template.status === "approved") entry.approved = template
      if (!entry.latest) entry.latest = template
      map.set(template.sourceDefinitionCode, entry)
    }
    return map
  }, [templates])
  const [code, setCode] = React.useState(importable[0]?.code ?? "")
  /*
   * Lo que la persona cambió a mano, atado a la definición para la que lo
   * cambió. Cambiar de definición vuelve a los valores propios de la nueva —el
   * tipo y la fuente preseleccionada salen de ella— sin un efecto que pise lo
   * escrito cuando llegan props nuevas.
   */
  const [kindEdit, setKindEdit] = React.useState<{ code: string; value: string } | null>(null)
  const [sourceEdit, setSourceEdit] = React.useState<{ code: string; id: string } | null>(null)
  /** Actividad elegida cuando la definición sirve a más de una. */
  const [activityEdit, setActivityEdit] = React.useState<{ code: string; value: string } | null>(null)
  const { open, changeOpen, operation } = useFormDialog(() => {
    setCode(importable[0]?.code ?? "")
    setKindEdit(null)
    setSourceEdit(null)
    setActivityEdit(null)
  })
  const definition = importable.find((item) => item.code === code)
  const existing = versionsByDefinition.get(code)
  const ambiguous = (definition?.pdtpActivities.length ?? 0) > 1

  // Una auditoría o una observación no son «inspección»: el tipo sale de la definición.
  const kind = kindEdit?.code === code ? kindEdit.value : definition?.defaultKind ?? "inspection"
  const activity = activityEdit?.code === code ? activityEdit.value : NO_ACTIVITY
  const gateInput = {
    needsOfficialSource: definition?.needsOfficialSource ?? false,
    officialChecksumSha256: definition?.officialChecksumSha256 ?? null,
    sources: documentSources,
  }
  // Un anexo oficial llega con su planilla elegida si la Biblioteca la tiene.
  const sourceVersionId = sourceEdit?.code === code ? sourceEdit.id : officialSourceGate({ ...gateInput, selectedId: "" }).preselectedId
  const gate = officialSourceGate({ ...gateInput, selectedId: sourceVersionId })

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const versionLabel = String(form.get("versionLabel") ?? "").trim()
    const sourceRevision = String(form.get("sourceRevision") ?? "").trim()
    operation.run(() => importInspectionTemplateAction({
      definitionCode: code,
      kind,
      versionLabel: versionLabel || undefined,
      sourceDocumentVersionId: sourceVersionId || undefined,
      sourceRevision: sourceRevision || undefined,
      // Sólo se manda cuando hay que desempatar. Omitirlo deja que el servicio
      // aplique el cableado por defecto, que es el caso de las nueve
      // definiciones con una sola actividad.
      ...(ambiguous && activity !== NO_ACTIVITY ? { pdtpActivityNumbers: [Number(activity)] } : {}),
    }), () => {
      toast.success("Plantilla incorporada como borrador.")
      changeOpen(false)
    })
  }

  // El diálogo sigue montado tras incorporar: parte de cero al abrir.
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm">Incorporar borrador</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Incorporar nueva versión como borrador</DialogTitle>
            <DialogDescription>
              Se crea como borrador: todavía no puede programarse ni ejecutarse. Para habilitarla, alguien con permiso de aprobación —puedes ser tú— la revisa y la aprueba.
            </DialogDescription>
          </DialogHeader>
          <Field label="Definición del catálogo SST">
            <Select value={code} onValueChange={setCode}><SelectTrigger aria-label="Definición del catálogo SST"><SelectValue /></SelectTrigger><SelectContent>{importable.map((item) => <SelectItem key={item.code} value={item.code}>{item.title}</SelectItem>)}</SelectContent></Select>
          </Field>
          {/* Combobox y no Select: la Biblioteca SST sembrada son 99+ versiones
              y en una lista desplegable sin buscar no se encuentra ninguna. El
              nombre del archivo viaja como `hint` para que también se pueda
              buscar por él, que suele ser lo que la persona recuerda. */}
          <Field
            label="Fuente documental de la Biblioteca SST"
            required={gate.required}
            hint={gate.required
              ? "Obligatoria: este instrumento transcribe un anexo oficial."
              : "Opcional: este instrumento no transcribe un anexo oficial."}
            error={operation.fieldError("sourceDocumentVersionId")}
          >
            <Combobox
              id="import-source-version"
              options={gate.candidates.map((source) => ({
                value: source.id,
                label: source.documentCode ?? source.documentTitle,
                hint: source.fileName,
              }))}
              value={sourceVersionId}
              onChange={(value) => setSourceEdit({ code, id: value })}
              placeholder="Buscar por código o nombre de archivo…"
              // Obligatoria no se puede dejar vacía: sin «limpiar», sólo se cambia de archivo.
              clearLabel={gate.required ? undefined : "Sin fuente vinculada"}
            />
          </Field>
          {gate.noMatch && (
            <Callout tone="warning">
              No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial. Súbela en Documentación; también puedes vincularla después con «Vincular fuente».
            </Callout>
          )}
          {sourceVersionId !== "" && <>
            <Field label="Revisión impresa"><Input name="sourceRevision" placeholder="Ej. Rev. 02" maxLength={120} /></Field>
            <p className="text-xs text-[var(--color-text-muted)]">La paridad con el anexo se declara después, desde «Declarar paridad» en el catálogo. Hasta entonces la plantilla no puede habilitarse.</p>
          </>}
          {definition && (
            <p className="text-xs text-[var(--color-text-subtle)]">
              {definition.sections} secciones · {definition.items} ítems · {coverageLabel(definition.coverage)}
              {definition.coverage.criticalityInert && " · sin gravedad por ítem, ningún hallazgo alcanzará criticidad alta."}
            </p>
          )}
          {/* Qué acredita en el programa anual. Una sola actividad se cablea
              sola; dos exigen elegir, porque la misma definición de EPP la
              ejecutan el JT (n=64) y el PRF (n=65) por separado. */}
          {definition && (definition.pdtpActivities.length === 1 && definition.pdtpActivities[0] ? (
            <p className="text-xs text-[var(--color-text-subtle)]">
              Acredita la actividad PDTP <span className="font-mono">N° {definition.pdtpActivities[0].n}</span> — {definition.pdtpActivities[0].name}.
            </p>
          ) : definition.pdtpActivities.length > 1 ? (
            // La misma definición de EPP la ejecutan el JT (n=64) y el PRF
            // (n=65) por separado: cablear las dos haría que un run de uno
            // cerrara la ocurrencia del otro, así que se elige una.
            <Field
              label="Actividad del PDTP que acredita"
              hint="Esta definición sirve a más de una; elige la del responsable que la va a ejecutar."
            >
              <Select value={activity} onValueChange={(value) => setActivityEdit({ code, value })}>
                <SelectTrigger aria-label="Actividad del PDTP que acredita"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTIVITY}>No acredita</SelectItem>
                  {definition.pdtpActivities.map((item) => (
                    <SelectItem key={item.n} value={String(item.n)}>N° {item.n} — {item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-xs text-[var(--color-text-subtle)]">
              No acredita ninguna actividad del programa anual.
            </p>
          ))}
          {existing?.approved && (
            <Callout tone="info" className="text-xs">
              Ya hay una versión vigente de esta definición: <span className="font-mono">{existing.approved.versionLabel}</span>.
              El nuevo borrador no reemplaza esta versión. El reemplazo ocurre recién cuando se aprueba, después de revisar su contenido.
            </Callout>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo">
              <Select value={kind} onValueChange={(value) => setKindEdit({ code, value })}><SelectTrigger aria-label="Tipo de instrumento"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field
              label="Etiqueta de versión"
              hint={existing?.latest
                ? `Ya existe ${existing.latest.versionLabel}; usa otra etiqueta.`
                : `Vacío = ${definition?.version ?? "versión de la definición"}.`}
              error={operation.fieldError("versionLabel")}
            >
              <Input name="versionLabel" maxLength={80} />
            </Field>
          </div>
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Incorporar como borrador" pending={operation.pending} disabled={gate.blocked} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Acreditación PDTP ─────────────────────────────────────────────────────── */

/**
 * Declara qué actividades del programa anual acredita la plantilla. Sin esto
 * el conector `onInspectionCompleted` no hace nada y la inspección jamás llega
 * al PDTP — que fue el estado de todas las plantillas hasta 2026-08-04.
 *
 * Abre con lo que la plantilla acredita hoy —los vínculos del catálogo o, si
 * todavía acredita por número, las actividades equivalentes— y manda **sólo los
 * ejes que la persona cambió**. Mandar siempre los dos vaciaba en silencio el
 * eje que no se tocó, y la plantilla dejaba de acreditar sin que nadie lo notara.
 */
function PdtpActivitiesDialog({ item, options }: { item: TemplateItem; options: PdtpActivityPickerOption[] }) {
  const preload = { execute: item.pdtpPreloadExecuteIds, review: item.pdtpPreloadReviewIds }
  const [execution, setExecution] = React.useState<string[]>(preload.execute)
  const [review, setReview] = React.useState<string[]>(preload.review)
  const { open, changeOpen, operation } = useFormDialog(() => { setExecution(preload.execute); setReview(preload.review) })
  const changed = changedPdtpAxes({ execute: execution, review }, preload)

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Acreditación PDTP</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(
              () => setInspectionTemplatePdtpActivitiesAction({
                templateId: item.id,
                expectedVersion: item.version,
                ...pdtpSavePayload({ execute: execution, review }, preload),
              }),
              () => {
                toast.success("Acreditación PDTP actualizada.")
                changeOpen(false)
              },
            )
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Acreditación PDTP · {item.name}</DialogTitle>
            <DialogDescription>
              Elige qué identidad corporativa acredita la ejecución y cuál acredita la revisión segregada.
            </DialogDescription>
          </DialogHeader>
          {options.length === 0 && (
            <Callout tone="warning">
              No hay actividades publicadas en el catálogo corporativo.
            </Callout>
          )}
          {options.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <PdtpActivityPicker multiple label="Al declarar ejecutada" options={options} value={execution} onChange={setExecution} />
                <AxisNotices
                  fromNumbers={item.pdtpAccreditation.executeSource === "numbers"}
                  numbers={item.pdtpActivityNumbers ?? []}
                  unmapped={item.pdtpUnmappedNumbers.execute}
                />
              </div>
              <div className="space-y-2">
                <PdtpActivityPicker multiple label="Al revisar y cerrar" options={options} value={review} onChange={setReview} />
                <AxisNotices
                  fromNumbers={item.pdtpAccreditation.reviewSource === "numbers"}
                  numbers={item.pdtpReviewActivityNumbers ?? []}
                  unmapped={item.pdtpUnmappedNumbers.review}
                />
              </div>
            </div>
          )}
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Guardar" pending={operation.pending} disabled={options.length === 0 || !changed.any} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Los avisos de un eje que todavía acredita por número: que hoy es así, y qué
 * pasa con los números que no tienen actividad equivalente en el catálogo.
 */
function AxisNotices({ fromNumbers, numbers, unmapped }: { fromNumbers: boolean; numbers: number[]; unmapped: number[] }) {
  if (!fromNumbers) return null
  return (
    <div className="space-y-2">
      <Callout tone="info" className="text-xs">{numbersAccreditationNotice(numbers.map((n) => `N° ${n}`))}</Callout>
      {unmapped.map((n) => (
        <Callout key={n} tone="warning" className="text-xs">{unmappedPdtpWarning(n)}</Callout>
      ))}
    </div>
  )
}

/* ── Aprobar plantilla ─────────────────────────────────────────────────────── */

function ApproveDialog({ templateId, name, expectedVersion }: { templateId: string; name: string; expectedVersion: number }) {
  const { open, changeOpen, operation } = useFormDialog()

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Aprobar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => approveInspectionTemplateAction({ templateId, expectedVersion, reason: form.get("reason") }), () => {
              toast.success("Plantilla aprobada.")
              changeOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Aprobar {name}</DialogTitle>
            <DialogDescription>Congela el contenido y reemplaza la versión aprobada anterior del mismo código.</DialogDescription>
          </DialogHeader>
          <ReasonField error={operation.fieldError("reason")} />
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Aprobar" pending={operation.pending} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Retirar plantilla ─────────────────────────────────────────────────────── */

/**
 * Saca un instrumento de circulación.
 *
 * Borra la fila si nunca se usó; si tiene ejecuciones o programaciones, la
 * marca retirada. Esa asimetría la resuelve el servidor, no esta pantalla: la
 * plantilla guarda el cuestionario congelado con el que se firmaron sus
 * inspecciones, y borrarla las dejaría sin las preguntas que respondieron. Lo
 * que sí hace esta pantalla es decir cuál de las dos cosas pasó, y a cuántas
 * programaciones activas dejó sin generar inspecciones.
 */
function RetireDialog({ templateId, name }: { templateId: string; name: string }) {
  const { open, changeOpen, operation } = useFormDialog()

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {/* I-20: una acción destructiva no se ve como una neutra. */}
      <DialogTrigger asChild><Button size="sm" variant="ghost-danger">Retirar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => retireInspectionTemplateAction({ templateId, reason: form.get("reason") }), (result) => {
              toast.success(retireTemplateMessage(result.data))
              changeOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Retirar {name}</DialogTitle>
            <DialogDescription>
              Deja de poder programarse y ejecutarse. Si nunca se usó, se elimina. Si tiene inspecciones, queda como «Retirada» con sus respuestas intactas, y sus programaciones dejan de generar inspecciones.
            </DialogDescription>
          </DialogHeader>
          <ReasonField error={operation.fieldError("reason")} />
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Retirar plantilla" variant="destructive" pending={operation.pending} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Gestión de una programación existente ────────────────────────────────
 * A-10/A-11: el diálogo de alta no ofrecía `intervalDays` (pese a que el Zod y
 * el CHECK lo soportan) y, una vez creada, la programación no se podía editar,
 * reasignar ni desactivar.
 */

function EditProgramDialog({ program, assignees, subjects, riskEntries }: {
  program: ProgramItem
  assignees: InspectionAssigneeOption[]
  subjects: InspectionSubjectOption[]
  riskEntries: { id: string; hazardCode: string; hazard: string }[]
}) {
  const [frequency, setFrequency] = React.useState(program.frequency)
  const [intervalDays, setIntervalDays] = React.useState(program.intervalDays)
  const [assignedToUserId, setAssignedToUserId] = React.useState(program.assignedToUserId ?? "_none")
  const [nextDueOn, setNextDueOn] = React.useState(program.nextDueOn)
  const [subjectRef, setSubjectRef] = React.useState(subjectRefFromIds(program))
  // INS-16: el servicio siempre aceptó cambiar el peligro y el formulario no lo ofrecía.
  const [riskEntryId, setRiskEntryId] = React.useState(program.riskEntryId ?? "_none")
  const { open, changeOpen, operation } = useFormDialog(() => {
    setFrequency(program.frequency)
    setIntervalDays(program.intervalDays)
    setAssignedToUserId(program.assignedToUserId ?? "_none")
    setNextDueOn(program.nextDueOn)
    setSubjectRef(subjectRefFromIds(program))
    setRiskEntryId(program.riskEntryId ?? "_none")
  })

  const requiresContainer = templateRequiresContainer(program.templateDefinitionCode)
  const subjectOptions = requiresContainer
    ? subjects.filter((subject) => subject.source === "container")
    : subjects

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subjectType = String(form.get("subjectType") ?? "").trim()
    // Quitarle el contenedor a un programa de contenedores lo dejaría
    // generando inspecciones sin sujeto; el servicio también lo rechaza.
    if (requiresContainer && !subjectRef.startsWith("container:")) {
      operation.setMessage("Selecciona un contenedor del catálogo de la faena.", "error")
      return
    }
    operation.run(() => updateInspectionProgramAction({
      programId: program.id,
      expectedVersion: program.version,
      frequency,
      intervalDays,
      nextDueOn,
      assignedToUserId: assignedToUserId === "_none" ? null : assignedToUserId,
      subjectType: subjectType || null,
      riskEntryId: riskEntryId === "_none" ? null : riskEntryId,
      ...subjectIdsFromRef(subjectRef),
    }), () => {
      toast.success("Programación actualizada.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Editar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar programación</DialogTitle>
            <DialogDescription>{program.templateName} · {program.worksiteName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Frecuencia" error={operation.fieldError("frequency")}>
              <Select value={frequency} onValueChange={(value) => { setFrequency(value); setIntervalDays(FREQUENCY_INTERVAL_DAYS[value] ?? 30) }}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Intervalo efectivo (días)" hint="Este número gobierna el calendario. Al cambiar la frecuencia se propone su intervalo estándar." error={operation.fieldError("intervalDays")}>
              <Input name="intervalDays" type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} required />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Próxima ejecución" error={operation.fieldError("nextDueOn")}>
              <DatePicker value={nextDueOn} onChange={setNextDueOn} />
            </Field>
            <Field label="Asignada a" hint="Opcional." error={operation.fieldError("assignedToUserId")}>
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={program.worksiteId} noneLabel="Sin asignar" /></SelectContent></Select>
            </Field>
          </div>
          {(subjectOptions.length > 0 || requiresContainer) && (
            <Field
              label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}
              required={requiresContainer}
              hint={requiresContainer
                ? "Obligatorio: cada inspección generada apuntará a este contenedor del catálogo."
                : "Opcional. Cada inspección generada apuntará a este recurso o equipo; un recurso del inventario actualiza su última inspección al completarse."}
            >
              <Select value={subjectRef} onValueChange={setSubjectRef}>
                <SelectTrigger aria-label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}>
                  <SelectValue placeholder={requiresContainer ? "Selecciona un contenedor" : "Sin sujeto del inventario"} />
                </SelectTrigger>
                <SelectContent>
                  {!requiresContainer && <SelectItem value={NO_SUBJECT}>Sin sujeto del inventario</SelectItem>}
                  {subjectOptions.map((subject) => (
                    <SelectItem key={subjectRefOf(subject)} value={subjectRefOf(subject)}>
                      {subject.source === "vehicle" ? "Equipo" : subject.source === "container" ? "Contenedor" : "Recurso"} · {subject.name}
                      {subject.source !== "container" && subject.location ? ` · ${subject.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {requiresContainer && subjectOptions.length === 0 && (
                <Callout tone="warning" className="mt-2 text-xs">
                  Esta faena todavía no tiene contenedores en el catálogo. Cárgalos en <Link href="/admin/contenedores" className="underline">Administración › Contenedores</Link>.
                </Callout>
              )}
            </Field>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor." error={operation.fieldError("subjectType")}>
              <Input name="subjectType" maxLength={120} defaultValue={program.subjectType ?? ""} />
            </Field>
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de esta faena." error={operation.fieldError("riskEntryId")}>
              <Select value={riskEntryId} onValueChange={setRiskEntryId}>
                <SelectTrigger aria-label="Peligro MIPER de origen"><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin vincular</SelectItem>
                  {riskEntries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.hazardCode} · {entry.hazard}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <OperationError operation={operation} />
          <FormDialogFooter submitLabel="Guardar" pending={operation.pending} onCancel={() => changeOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Desactivar es el borrado: los runs ya creados conservan su origen. */
function ToggleProgramButton({ program }: { program: ProgramItem }) {
  const { open, changeOpen, operation } = useFormDialog()
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {/* I-20: "Detener" es destructivo (frena la generación futura); "Reactivar" no. */}
        <Button type="button" size="sm" variant={program.isActive ? "ghost-danger" : "ghost"}>{program.isActive ? "Detener" : "Reactivar"}</Button>
      </DialogTrigger>
      <DialogContent>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim()
          operation.run(() => updateInspectionProgramAction({
            programId: program.id,
            expectedVersion: program.version,
            isActive: !program.isActive,
            reason,
          }), () => {
            toast.success(program.isActive ? "Programación detenida." : "Programación reactivada.")
            changeOpen(false)
          })
        }}>
          <DialogHeader>
            <DialogTitle>{program.isActive ? "¿Detener esta programación?" : "¿Reactivar esta programación?"}</DialogTitle>
            <DialogDescription>{program.isActive
              ? "No se crearán futuras inspecciones automáticas. Las ya creadas se conservan y pueden seguir ejecutándose."
              : "Volverán a generarse inspecciones desde la próxima fecha configurada."}</DialogDescription>
          </DialogHeader>
          <ReasonField error={operation.fieldError("reason")} />
          <OperationError operation={operation} />
          <FormDialogFooter
            submitLabel={program.isActive ? "Detener programación" : "Reactivar programación"}
            variant={program.isActive ? "destructive" : "primary"}
            pending={operation.pending}
            onCancel={() => changeOpen(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Materializa la ejecución del período por el mismo camino que el cron. */
function RunProgramNowButton({ program }: { program: ProgramItem }) {
  const operation = useOperation()
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const today = todayInChile()
  // I-01: cada ejecución avanza `nextDueOn` un intervalo completo
  // (materializeProgramRuns), sin exigir que el programa esté vencido cuando
  // se llama con `programId` explícito. Regularizar una vencida es el camino
  // correcto y no debe pedir confirmación; crearla fuera de ciclo sí consume
  // un ciclo del programa anual y merece decirlo antes, no después.
  const outOfCycle = program.frequency !== "on_demand" && program.nextDueOn > today
  const nextAfter = nextDueAfter(program.nextDueOn, program.intervalDays, today)

  function create() {
    setConfirming(false)
    operation.run(() => runProgramNowAction({ programId: program.id }), (result) => {
      const runId = result.data?.runId
      if (typeof runId === "string") router.push(`/prevencion/inspecciones/${runId}`)
    })
  }

  return (
    <div className="space-y-1 text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        onClick={() => (outOfCycle ? setConfirming(true) : create())}
      >
        {operation.pending ? "Creando…" : "Crear y abrir inspección"}
      </Button>
      <InlineError operation={operation} className="max-w-64" />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        variant="warning"
        title="Esta programación aún no vence"
        description={`La próxima inspección de "${program.templateName}" está programada para el ${formatDate(program.nextDueOn)}. Crearla ahora consume ese ciclo: la próxima pasará al ${formatDate(nextAfter)}. ¿Crear de todos modos?`}
        confirmLabel="Crear igual y mover la fecha"
        cancelLabel="No crear"
        onConfirm={create}
        loading={operation.pending}
      />
    </div>
  )
}

/* ── Alta de programación ─────────────────────────────────────────────────── */

export function ProgramDialog({ templates, worksites, assignees, riskEntriesByWorksite, subjectsByWorksite = {} }: {
  templates: { id: string; name: string; versionLabel: string; kind?: string | null; sourceDefinitionCode?: string | null }[]
  worksites: { id: string; name: string }[]
  assignees: InspectionAssigneeOption[]
  riskEntriesByWorksite: Record<string, { id: string; hazardCode: string; hazard: string }[]>
  /** Inventario por faena: declarar QUÉ se inspecciona, no sólo con qué instrumento (INS-04). */
  subjectsByWorksite?: Record<string, InspectionSubjectOption[]>
}) {
  const [startsOn, setStartsOn] = React.useState("")
  const [templateId, setTemplateId] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [frequency, setFrequency] = React.useState("monthly")
  const [intervalDays, setIntervalDays] = React.useState(FREQUENCY_INTERVAL_DAYS.monthly)
  const [assignedToUserId, setAssignedToUserId] = React.useState("_none")
  const [riskEntryId, setRiskEntryId] = React.useState("_none")
  const [subjectRef, setSubjectRef] = React.useState(NO_SUBJECT)
  const { open, changeOpen, operation } = useFormDialog(() => {
    setTemplateId("")
    setWorksiteId("")
    setStartsOn(todayInChile())
    setFrequency("monthly")
    setIntervalDays(FREQUENCY_INTERVAL_DAYS.monthly)
    setAssignedToUserId("_none")
    setRiskEntryId("_none")
    setSubjectRef(NO_SUBJECT)
  })

  /* La programación de contenedores exige sujeto por el mismo motivo que la
   * ejecución: un programa sin contenedor produce runs sin sujeto. */
  const requiresContainer = templateRequiresContainer(
    templates.find((item) => item.id === templateId)?.sourceDefinitionCode)
  const worksiteSubjects = subjectsByWorksite[worksiteId] ?? []
  const subjectOptions = requiresContainer
    ? worksiteSubjects.filter((subject) => subject.source === "container")
    : worksiteSubjects

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const assignee = String(form.get("assignedToUserId") ?? "").trim()
    const subjectType = String(form.get("subjectType") ?? "").trim()
    const riskEntry = String(form.get("riskEntryId") ?? "").trim()
    if (!templateId || !worksiteId || !startsOn) {
      operation.setMessage("Selecciona la plantilla, la faena y la primera fecha.", "error")
      return
    }
    if (requiresContainer && !subjectRef.startsWith("container:")) {
      operation.setMessage("Selecciona un contenedor del catálogo de la faena.", "error")
      return
    }
    operation.run(() => createInspectionProgramAction({
      templateId: form.get("templateId"),
      worksiteId: form.get("worksiteId"),
      frequency: form.get("frequency"),
      // A-10: el Zod y el CHECK siempre lo soportaron; el formulario no lo ofrecía.
      intervalDays,
      startsOn: form.get("startsOn"),
      assignedToUserId: assignee || null,
      subjectType: subjectType || null,
      riskEntryId: riskEntry || null,
      ...subjectIdsFromRef(subjectRef),
    }), () => {
      toast.success("Programación creada.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo programa</Button></DialogTrigger>
      <DialogContent className="overflow-hidden p-0">
        <form onSubmit={submit} className="flex max-h-[min(90dvh,54rem)] flex-col">
          <DialogHeader className="mb-0 shrink-0 border-b border-[var(--color-border)] px-6 pb-4 pt-6">
            <DialogTitle>Nueva programación</DialogTitle>
            <DialogDescription>Elige explícitamente el instrumento y la faena. Sólo las plantillas aprobadas pueden programarse.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <Field label="Plantilla" error={operation.fieldError("templateId")}>
            <InspectionTemplateSelect templates={templates} value={templateId} onValueChange={setTemplateId} /><input type="hidden" name="templateId" value={templateId} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena" error={operation.fieldError("worksiteId")}>
              <Select value={worksiteId} onValueChange={(value) => {
                setWorksiteId(value)
                setRiskEntryId("_none")
                setSubjectRef(NO_SUBJECT)
                setAssignedToUserId(findWorksiteSuggestedAssignee(assignees, value))
              }}><SelectTrigger aria-label="Faena del programa"><SelectValue placeholder="Selecciona la faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
            </Field>
            <Field label="Frecuencia" error={operation.fieldError("frequency")}>
              <Select value={frequency} onValueChange={(value) => { setFrequency(value); setIntervalDays(FREQUENCY_INTERVAL_DAYS[value] ?? 30) }}><SelectTrigger aria-label="Frecuencia"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INSPECTION_FREQUENCY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><input type="hidden" name="frequency" value={frequency} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Primera fecha" required error={operation.fieldError("startsOn")}>
              <DatePicker name="startsOn" value={startsOn} onChange={setStartsOn} />
            </Field>
            <Field label="Intervalo efectivo (días)" hint="Este número gobierna el calendario. Al cambiar la frecuencia se propone su intervalo estándar." error={operation.fieldError("intervalDays")}>
              <Input name="intervalDays" type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} required />
            </Field>
            <Field label="Asignada a" hint="Opcional. El prevencionista de la faena se sugiere automáticamente al elegirla." error={operation.fieldError("assignedToUserId")}>
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}><SelectTrigger aria-label="Asignada a"><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><AssigneeSelectOptions assignees={assignees} worksiteId={worksiteId} noneLabel="Sin asignar" /></SelectContent></Select><input type="hidden" name="assignedToUserId" value={assignedToUserId === "_none" ? "" : assignedToUserId} />
            </Field>
          </div>
          {/* Con plantilla de contenedores el campo se muestra siempre, incluso
              sin opciones: desaparecer dejaba pasar el alta sin sujeto. */}
          {(subjectOptions.length > 0 || requiresContainer) && (
            <Field
              label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}
              required={requiresContainer}
              hint={requiresContainer
                ? "Obligatorio: cada inspección generada apuntará a este contenedor del catálogo."
                : "Opcional. Cada inspección generada apuntará a este recurso o equipo, y el prevencionista sabrá qué va a inspeccionar."}
            >
              <Select value={subjectRef} onValueChange={setSubjectRef}>
                <SelectTrigger aria-label={requiresContainer ? "Contenedor inspeccionado" : "Sujeto inspeccionado"}>
                  <SelectValue placeholder={requiresContainer ? "Selecciona un contenedor" : "Sin sujeto del inventario"} />
                </SelectTrigger>
                <SelectContent>
                  {!requiresContainer && <SelectItem value={NO_SUBJECT}>Sin sujeto del inventario</SelectItem>}
                  {subjectOptions.map((subject) => (
                    <SelectItem key={subjectRefOf(subject)} value={subjectRefOf(subject)}>
                      {subject.source === "vehicle" ? "Equipo" : subject.source === "container" ? "Contenedor" : "Recurso"} · {subject.name}
                      {subject.source !== "container" && subject.location ? ` · ${subject.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {requiresContainer && subjectOptions.length === 0 && (
                <Callout tone="warning" className="mt-2 text-xs">
                  Esta faena todavía no tiene contenedores en el catálogo. Cárgalos en <Link href="/admin/contenedores" className="underline">Administración › Contenedores</Link>.
                </Callout>
              )}
            </Field>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de sujeto" hint="Opcional. Ej: extintor, camión, contenedor." error={operation.fieldError("subjectType")}><Input name="subjectType" maxLength={120} /></Field>
            {/* A-09: antes era un `<Input>` donde el usuario debía escribir el
                UUID del peligro a mano, sin validar existencia ni faena. */}
            <Field label="Peligro MIPER de origen" hint="Opcional. Los de la faena seleccionada." error={operation.fieldError("riskEntryId")}>
              <Select value={riskEntryId} onValueChange={setRiskEntryId}>
                <SelectTrigger aria-label="Peligro MIPER de origen"><SelectValue placeholder="Sin vincular" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin vincular</SelectItem>
                  {(riskEntriesByWorksite[worksiteId] ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.hazardCode} · {entry.hazard}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="riskEntryId" value={riskEntryId === "_none" ? "" : riskEntryId} />
            </Field>
          </div>
          <OperationError operation={operation} />
          </div>
          <FormDialogFooter
            className="mt-0 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4"
            submitLabel={operation.pending ? "Programando…" : "Programar"}
            pending={operation.pending}
            disabled={!templateId || !worksiteId || !startsOn}
            onCancel={() => changeOpen(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}
