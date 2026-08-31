"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assessRunCompletion,
  assessRunReview,
  addDays,
  capaPriorityForCriticality,
  criticalityBadgeVariant,
  effectiveRequiredItems,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  fieldKindIsScorable,
  inspectionResultLabel,
  inspectionResultOptionsFor,
  formatSignatureRole,
  resultBadgeVariant,
  resultSelectToneClass,
  runStatusBadgeVariant,
  summarizeCompliance,
  validateAnswerRow,
  type ClosingActInput,
  type ClosingActSpec,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition, FieldKind } from "@/lib/sst/types"
import { formatDate, formatDateTime, todayInChile } from "@/lib/utils"
import {
  cancelInspectionRunAction,
  closeInspectionFindingAction,
  completeInspectionRunAction,
  createFindingCapaAction,
  registerDeviationAction,
  registerInspectionPreventiveActionAction,
  remindInspectionReviewAction,
  removeDeviationAction,
  reopenInspectionRunAction,
  reviewInspectionRunAction,
  saveInspectionAnswersAction,
  saveInspectionParticipantsAction,
  stopVehicleForFindingAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { autosaveStatusLabel, useDebouncedAutosave } from "@/lib/hooks/use-debounced-autosave"
import {
  clearInspectionDraft,
  readInspectionDraft,
  writeInspectionDraft,
} from "@/lib/prevention/inspection-draft-storage"
import { compressPhoto } from "@/lib/pwa/image-compress"
import { inspectionSubjectTypeLabel, inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import type { OfflineInspectionSubmission } from "./offline-inspection-queue"

interface RunInfo {
  id: string
  code: string
  status: string
  origin: string
  subjectType: string | null
  subjectLabel: string | null
  subjectResourceId: string | null
  /** Equipo de flota inspeccionado; habilita derivar a mantención. */
  subjectVehicleId: string | null
  scheduledFor: string | null
  executedAt: string | null
  reviewedAt: string | null
  reviewComment: string | null
  conformingCount: number
  partialCount: number
  nonConformingCount: number
  notApplicableCount: number
  compliancePercent: number | null
  officialComplianceBasisPoints: number | null
  normalizedComplianceBasisPoints: number | null
  executedByUserId: string | null
  closingResult: string | null
  closingRestrictions: string | null
  closingSignatures: { role: string; name: string; userId: string | null; signedAt: string }[] | null
  locationLatitude: string | null
  locationLongitude: string | null
  version: number
}

interface ItemInfo {
  id: string
  label: string
  kind?: FieldKind
  required: boolean
  countsForCompliance: boolean
  danoPotencial: string | null
  options?: { value: string; label: string }[]
  placeholder?: string
  matrix?: { rowId: string; rowLabel: string; columnLabel: string }
}

interface SectionInfo {
  id: string
  title: string
  items: ItemInfo[]
}

interface AnswerInfo {
  /** Id de la fila persistida: es a lo que cuelga la evidencia (función #1). */
  answerId: string
  sectionId: string
  itemId: string
  result: string
  comment: string | null
  /** Respuesta de los ítems que no puntúan (B-08). */
  value: string | null
  /** Fotos adjuntas a esta respuesta (función #1). */
  evidence: { id: string; path: string; caption: string | null }[]
  /** La pre-llenó el reconocimiento y falta ratificarla (sólo ítems `fatal`). */
  needsConfirmation: boolean
}

interface FindingInfo {
  id: string
  description: string
  criticality: string
  status: string
  capaActionId: string | null
  /** `derived` lo levantó un ítem; `deviation` lo registró una persona. */
  origin: string
  potentialDamageDescription: string | null
  immediateMeasure: string | null
  applicableLaw: string | null
  evidence: { id: string; path: string; caption: string | null }[]
}

type ResultValue = "" | "conforming" | "partial" | "non_conforming" | "not_applicable" | "recorded"
interface Draft { result: ResultValue; comment: string; value: string; needsConfirmation: boolean }

/** La planilla física subida y, cuando exista el detector, lo que leyó. */
export interface RunDocumentInfo {
  id: string
  path: string
  caption: string | null
  createdAt: string
}

interface Props {
  run: RunInfo
  templateKind: string
  /** El instrumento registra desviaciones en vez de puntuar ítems. */
  recordsDeviations: boolean
  recordsPreventiveActions: boolean
  /** Catálogo activo del instrumento: de acá sale la gravedad de cada desviación. */
  deviationCatalog: { id: string; label: string; danoPotencial: string; criticality: string }[]
  /** Actividades del programa anual que esta inspección acredita al ejecutarse. */
  pdtpActivityNumbers: number[]
  /** Y las que acredita al revisarse y firmarse: son otra ocurrencia y otro responsable. */
  pdtpReviewActivityNumbers: number[]
  worksiteName: string
  assigneeName: string | null
  executorName: string | null
  reviewerName: string | null
  sections: SectionInfo[]
  answers: AnswerInfo[]
  findings: FindingInfo[]
  isUnplannedInspection: boolean
  participants: { id: string; name: string; position: string; userId: string | null }[]
  currentUserId: string
  assignees: { id: string; name: string }[]
  /** I-08: quién puede cerrarla en esta faena; se resuelve sólo cuando el bloqueo aplica. */
  reviewers: { id: string; name: string }[]
  canExecute: boolean
  canReview: boolean
  canManage: boolean
  canRequestRecharge: boolean
  /** `combustibles:manage_vehicles`: confirma sacar el equipo de servicio. */
  canStopVehicle: boolean
  /** Planillas físicas adjuntas al run. */
  documents: RunDocumentInfo[]
  /** `prevention:inspections:ingest`: sube la foto de la planilla. */
  canIngest: boolean
  /** Acta que declara la plantilla; `null` si no exige uno. */
  closingAct: ClosingActSpec | null
  scoringPolicy?: ChecklistDefinition["scoringPolicy"]
  /** Reporte de Equipos: el papel es el insumo que el jefe de faena transcribe. */
  physicalSourceRequired: boolean
}

function draftKey(sectionId: string, itemId: string) {
  return `${sectionId}::${itemId}`
}

/**
 * I-06: el árbol móvil y el de escritorio coexisten en el DOM —uno oculto por
 * `md:hidden`/`hidden md:*`—, así que sólo uno está realmente visible. Se
 * prueba primero el id móvil y se usa `offsetParent` (null si el elemento o un
 * ancestro tiene `display:none`) para devolver el que esté pintado.
 */
function visibleItemElement(key: string): HTMLElement | null {
  for (const prefix of ["item-mobile-", "item-desktop-"]) {
    const el = document.getElementById(`${prefix}${key}`)
    if (el && el.offsetParent !== null) return el
  }
  return null
}

/** Salta al ítem y enfoca su primer control, para dejar a la persona lista para responder. */
function jumpToItem(key: string) {
  const el = visibleItemElement(key)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.querySelector<HTMLElement>("button, select, input, textarea, [tabindex]")?.focus()
}

/**
 * I-19: el chip de navegación anteponía "{index+1}. " sobre `section.title`,
 * y una parte del catálogo SST ya numera sus secciones en el propio título
 * ("1. Documentos") mientras otra parte no ("Observaciones generales") — no
 * es consistente, así que no basta con quitar el prefijo siempre: sólo se
 * omite cuando el título ya empieza con un número.
 */
const SECTION_TITLE_ALREADY_NUMBERED = /^\d+\.\s/
function sectionNavLabel(title: string, index: number) {
  return SECTION_TITLE_ALREADY_NUMBERED.test(title) ? title : `${index + 1}. ${title}`
}

/**
 * Diálogo genérico de "acción con motivo obligatorio": cancelar, reabrir,
 * cerrar hallazgo. Las tres son la misma interacción, y el servicio exige el
 * mismo mínimo de 10 caracteres en todas.
 */
/**
 * I-08: recordatorio manual para quien puede cerrar una inspección bloqueada.
 * `createNotifications` deduplica por día, así que el botón nunca satura —
 * clics repetidos el mismo día son inocuos.
 */
function RemindReviewButton({ runId }: { runId: string }) {
  const operation = useOperation()
  return (
    <div className="mt-2 space-y-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        onClick={() => operation.run(
          () => remindInspectionReviewAction({ runId }),
          (result) => {
            const names = result.data?.notified
            if (Array.isArray(names) && names.length > 0) operation.setMessage(`Recordatorio enviado a ${names.join(", ")}.`)
          },
        )}
      >
        {operation.pending ? "Enviando…" : "Recordar a quien revisa"}
      </Button>
      <p className="text-xs text-[var(--color-text-subtle)]">Se envía como máximo un recordatorio al día.</p>
      {operation.message && <p role="status" className="text-xs">{operation.message}</p>}
    </div>
  )
}

/**
 * I-20: las 4 acciones destructivas del módulo (Cancelar, Detener, Cerrar,
 * Retirar) se veían como texto plano indistinguible de una acción neutra —
 * "ghost" a secas. Un ghost coloreado en rojo tenue es lo bastante discreto
 * para convivir con la acción primaria y lo bastante visible para no
 * confundirse con "Reabrir para rectificar", que no lo es.
 */
const GHOST_DANGER_CLASS = "text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"

function ReasonDialog({ trigger, title, description, action, onDone, variant = "ghost", confirmLabel }: {
  trigger: string
  title: string
  description: string
  action: (reason: string) => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }>
  onDone?: (result: { data?: Record<string, unknown> }) => void
  variant?: "ghost" | "secondary" | "ghost-danger"
  confirmLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant === "ghost-danger" ? "ghost" : variant} className={variant === "ghost-danger" ? GHOST_DANGER_CLASS : undefined}>{trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
            operation.run(() => action(reason), (result) => {
              onDone?.(result)
              setOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres.">
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>{confirmLabel ?? trigger}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Control de un ítem que no expresa conformidad (B-08).
 *
 * `observacion_planeada` es enteramente de este tipo —un relato libre— y por
 * eso ninguna observación podía completarse: el motor sólo sabía preguntar
 * "¿cumple?". `inspeccion_extintores` mezcla ambos (N° de serie, fecha de
 * vencimiento de carga, tipo).
 */
function NonScorableField({ item, value, onChange }: {
  item: ItemInfo
  value: string
  onChange: (next: string) => void
}) {
  const label = `Respuesta de ${item.label}`
  if (item.kind === "textarea") {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={item.placeholder ?? "Escribe aquí…"}
        aria-label={label}
        rows={4}
        maxLength={2000}
      />
    )
  }
  if (item.kind === "date") {
    return <DatePicker value={value} onChange={onChange} ariaLabel={label} />
  }
  if (item.kind === "number") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={item.placeholder ?? "Sin separador de miles"}
        aria-label={label}
      />
    )
  }
  if (item.kind === "select" && item.options?.length) {
    return (
      <Select value={value || "__unset__"} onValueChange={(next) => onChange(next === "__unset__" ? "" : next)}>
        <SelectTrigger aria-label={label}><SelectValue placeholder="Sin responder" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">Sin responder</SelectItem>
          {item.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={item.placeholder ?? "Escribe aquí…"}
      aria-label={label}
      maxLength={2000}
    />
  )
}

/**
 * Evidencia fotográfica de una respuesta (función #1).
 *
 * `evidenceReference` existía en el esquema y en el export, y ninguna pantalla
 * adjuntaba nada: una inspección sin foto del hallazgo no sirve como evidencia.
 *
 * La foto cuelga de la respuesta, así que el ítem debe estar respondido y
 * guardado antes de poder adjuntar — de ahí que el control se deshabilite
 * mientras no exista `answerId`.
 */
function inspectionEvidenceFileName(path: string) {
  return path.split("/").pop() ?? ""
}

function FindingEvidence({ findingId, evidence, editable }: {
  findingId: string
  evidence: { id: string; path: string; caption: string | null }[]
  editable: boolean
}) {
  const [uploadedItems, setUploadedItems] = React.useState<typeof evidence>([])
  const [caption, setCaption] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const items = React.useMemo(() => {
    const byId = new Map(evidence.map((item) => [item.id, item]))
    for (const item of uploadedItems) byId.set(item.id, item)
    return [...byId.values()]
  }, [evidence, uploadedItems])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError("")
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("findingId", findingId)
        body.set("caption", caption)
        const response = await fetch("/api/prevencion/inspecciones/finding-evidence", { method: "POST", body })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(failure.error ?? "No se pudo subir la evidencia.")
        }
        const json = await response.json()
        setUploadedItems((current) => [...current, { id: json.id, path: json.path, caption: json.caption }])
      }
      setCaption("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la evidencia.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && <div className="flex flex-wrap gap-2">{items.map((item) => {
        const name = inspectionEvidenceFileName(item.path)
        return <a key={item.id} href={`/api/prevencion/inspecciones/evidence/${name}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL autenticada y dinámica. */}
          <img src={`/api/prevencion/inspecciones/evidence/${name}`} alt={item.caption ?? "Evidencia del hallazgo"} className="h-16 w-16 rounded border border-[var(--color-border)] object-cover" />
        </a>
      })}</div>}
      {editable && <div className="flex flex-wrap items-end gap-2">
        <Field label="Leyenda de la evidencia"><Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} /></Field>
        <input ref={inputRef} type="file" accept="image/*" multiple aria-label="Adjuntar evidencias del hallazgo" className="sr-only" onChange={(event) => { void upload(event.target.files); event.target.value = "" }} />
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Subiendo…" : "Adjuntar fotos"}</Button>
      </div>}
      {error && <p role="status" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}

export function AnswerEvidence({ answerId, evidence, editable, readyToPersist, ensureAnswerId }: {
  answerId: string | null
  evidence: { id: string; path: string; caption: string | null }[]
  editable: boolean
  /** Existe una respuesta válida en el borrador y puede guardarse. */
  readyToPersist: boolean
  /** Autosave que crea la fila persistida cuando la foto es el primer guardado. */
  ensureAnswerId?: () => Promise<string>
}) {
  const [items, setItems] = React.useState(evidence)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { setItems(evidence) }, [evidence])

  async function upload(files: FileList | null) {
    if (!files?.length || !readyToPersist) return
    setBusy(true)
    setError("")
    try {
      const persistedAnswerId = answerId ?? await ensureAnswerId?.()
      if (!persistedAnswerId) throw new Error("No se pudo guardar la respuesta antes de adjuntar la foto.")
      // Secuencial y no en paralelo: en terreno la conexión es escasa y varias
      // subidas simultáneas se estorban entre sí.
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("answerId", persistedAnswerId)
        const response = await fetch("/api/prevencion/inspecciones/evidence", { method: "POST", body })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(failure.error ?? "No se pudo subir la foto.")
        }
        const json = await response.json()
        setItems((current) => [...current, { id: json.id, path: json.path, caption: null }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <a
              key={item.id}
              href={`/api/prevencion/inspecciones/evidence/${inspectionEvidenceFileName(item.path)}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autenticada; next/image no aporta aquí. */}
              <img
                src={`/api/prevencion/inspecciones/evidence/${inspectionEvidenceFileName(item.path)}`}
                alt={item.caption ?? "Evidencia de la inspección"}
                className="h-16 w-16 rounded border border-[var(--color-border)] object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {editable && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={!readyToPersist || busy}
            onChange={(event) => { void upload(event.target.files); event.target.value = "" }}
            aria-label="Adjuntar evidencia fotográfica"
            className="sr-only"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!readyToPersist || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Subiendo…" : items.length > 0 ? "Agregar fotos" : "Adjuntar fotos"}
          </Button>
          {!readyToPersist && <p className="text-xs text-[var(--color-text-subtle)]">Responde el ítem para habilitar fotografías.</p>}
          {readyToPersist && !answerId && <p className="text-xs text-[var(--color-text-subtle)]">Al elegir una foto, esta respuesta se guardará automáticamente.</p>}
          {busy && <p className="text-xs text-[var(--color-text-subtle)]">Subiendo…</p>}
          {error && <p role="status" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
        </>
      )}
    </div>
  )
}

export function InspectionRunDetail({
  run, templateKind, recordsDeviations, recordsPreventiveActions, deviationCatalog,
  pdtpActivityNumbers, pdtpReviewActivityNumbers,
  worksiteName, assigneeName, executorName, reviewerName,
  sections, answers, findings, isUnplannedInspection, participants, currentUserId, assignees, reviewers, canExecute, canReview, canManage, canStopVehicle, canRequestRecharge,
  documents, canIngest, closingAct,
  scoringPolicy,
  physicalSourceRequired,
}: Props) {
  const editable = canExecute && ["planned", "in_progress"].includes(run.status)
  const items: InspectionItemSpec[] = React.useMemo(
    () => sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionId: section.id, itemId: item.id }))),
    [sections],
  )

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {}
    for (const answer of answers) {
      initial[draftKey(answer.sectionId, answer.itemId)] = {
        result: answer.result as ResultValue,
        comment: answer.comment ?? "",
        value: answer.value ?? "",
        needsConfirmation: answer.needsConfirmation ?? false,
      }
    }
    return initial
  })
  const operation = useOperation()
  /* INS-02: el hook de autoguardado vigila un primitivo por valor, así que un
   * contador que sube en cada edición cumple sin serializar el mapa completo en
   * cada render. Mismo patrón que `use-checklist-responses.ts` en el motor SST. */
  const [revision, setRevision] = React.useState(0)
  const [restoredDraft, setRestoredDraft] = React.useState(false)

  /* Espejo local recuperado. Sólo se aplica si es MÁS nuevo que lo que trae el
   * servidor (misma versión del run): si alguien guardó desde otra sesión, lo
   * persistido manda y el espejo se descarta, o restaurar pisaría trabajo ajeno
   * con un borrador viejo del dispositivo. */
  React.useEffect(() => {
    if (!editable) return
    const snapshot = readInspectionDraft(run.id)
    if (!snapshot || snapshot.version !== run.version) {
      if (snapshot) clearInspectionDraft(run.id)
      return
    }
    setDrafts((current) => {
      const restored = { ...current }
      for (const [key, draft] of Object.entries(snapshot.drafts)) {
        restored[key] = {
          result: draft.result as ResultValue,
          comment: draft.comment ?? "",
          value: draft.value ?? "",
          needsConfirmation: draft.needsConfirmation ?? false,
        }
      }
      return restored
    })
    setRestoredDraft(true)
    // Sólo al montar: después manda lo que la persona esté tecleando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id])

  // C-02: el guardado ahora sube `version`, así que el CAS del siguiente envío
  // debe usar la que devolvió el servidor y no la de las props, que quedó
  // obsoleta en cuanto se guardó una vez.
  const [version, setVersion] = React.useState(run.version)
  React.useEffect(() => { setVersion(run.version) }, [run.version])

  // Función faltante #8: `locationLatitude/Longitude` ya se aceptaban en el
  // servicio y ninguna pantalla los enviaba nunca.
  // Función #2: el acta que la plantilla declara y nadie podía llenar.
  const [closing, setClosing] = React.useState<ClosingActInput>(() => ({
    result: run.closingResult ?? "",
    restrictions: run.closingRestrictions ?? "",
    signatures: (closingAct?.signatureRoles ?? []).map((role) => ({
      role,
      name: run.closingSignatures?.find((item) => item.role === role)?.name ?? "",
      userId: run.closingSignatures?.find((item) => item.role === role)?.userId ?? null,
    })),
  }))

  const [coords, setCoords] = React.useState<{ lat: string; lon: string } | null>(() =>
    run.locationLatitude && run.locationLongitude ? { lat: run.locationLatitude, lon: run.locationLongitude } : null,
  )
  React.useEffect(() => {
    if (run.locationLatitude && run.locationLongitude) setCoords({ lat: run.locationLatitude, lon: run.locationLongitude })
  }, [run.locationLatitude, run.locationLongitude])
  const [geoState, setGeoState] = React.useState<"idle" | "pending" | "denied">("idle")

  // Función #9: la idempotencia del servidor (`clientSubmissionId`, su índice
  // único y el retorno `alreadyCompleted`) ya existía; faltaba el cliente.
  const [queued, setQueued] = React.useState(0)
  const [offlineNote, setOfflineNote] = React.useState("")

  const refreshQueue = React.useCallback(async () => {
    const { listQueuedInspectionSubmissions } = await import("./offline-inspection-queue")
    const entries = await listQueuedInspectionSubmissions()
    setQueued(entries.filter((entry) => entry.payload.runId === run.id).length)
  }, [run.id])

  const flushQueue = React.useCallback(async () => {
    const { flushInspectionSubmissionQueue } = await import("./offline-inspection-queue")
    const result = await flushInspectionSubmissionQueue(async (payload) => {
      const response = await completeInspectionRunAction(payload)
      // Un rechazo de validación o de estado no se arregla reintentando: se
      // quema de golpe para que no quede como zombi en la cola.
      return { ok: response.ok, message: response.message, retriable: response.ok ? undefined : false }
    })
    if (result.synchronized > 0) setOfflineNote("Inspección sincronizada.")
    else if (result.rejected > 0) {
      /* INS-19: el rechazo decía "revisa los datos" y el motivo real quedaba
       * en IndexedDB sin que nadie lo leyera — típicamente que la inspección
       * cambió en otra sesión y el CAS ya no cuadra. Sin el motivo, quien
       * ejecutó no sabe si rehacer el cierre o pedir ayuda. */
      const { listQueuedInspectionSubmissions } = await import("./offline-inspection-queue")
      const entries = await listQueuedInspectionSubmissions()
      const failed = entries.find((entry) => entry.payload.runId === run.id)
      setOfflineNote(failed?.lastError
        ? `La sincronización fue rechazada: ${failed.lastError}`
        : "La sincronización fue rechazada; revisa los datos.")
    }
    await refreshQueue()
  }, [refreshQueue, run.id])

  React.useEffect(() => {
    void refreshQueue()
    // Al volver la conexión se intenta enviar lo pendiente sin que el usuario
    // tenga que acordarse.
    function onOnline() { void flushQueue() }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [refreshQueue, flushQueue])

  function captureLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoState("denied"); return }
    setGeoState("pending")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude.toFixed(6), lon: position.coords.longitude.toFixed(6) })
        setGeoState("idle")
      },
      // Degradación silenciosa: la ubicación es un dato de apoyo, nunca un
      // bloqueo para registrar la inspección.
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  function update(sectionId: string, itemId: string, patch: Partial<Draft>) {
    setRevision((value) => value + 1)
    setDrafts((current) => {
      const key = draftKey(sectionId, itemId)
      const base = current[key] ?? { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }
      // Responder el ítem lo ratifica: si la persona eligió el resultado, ya
      // miró la celda. Editar sólo el comentario no basta.
      const confirmedByAnswering = patch.result !== undefined
      return {
        ...current,
        [key]: { ...base, ...patch, needsConfirmation: confirmedByAnswering ? false : base.needsConfirmation },
      }
    })
  }

  /** Ratifica lo que leyó la máquina sin cambiar la respuesta. */
  function confirmRead(sectionId: string, itemId: string) {
    setRevision((value) => value + 1)
    setDrafts((current) => {
      const key = draftKey(sectionId, itemId)
      const base = current[key]
      if (!base) return current
      return { ...current, [key]: { ...base, needsConfirmation: false } }
    })
  }

  const currentAnswers: InspectionAnswerInput[] = React.useMemo(
    () => Object.entries(drafts)
      .filter(([, draft]) => draft.result !== "")
      .map(([key, draft]) => {
        const [sectionId, itemId] = key.split("::")
        return {
          sectionId: sectionId!,
          itemId: itemId!,
          result: draft.result as InspectionAnswerInput["result"],
          comment: draft.comment || null,
          value: draft.value || null,
          needsConfirmation: draft.needsConfirmation,
        }
      }),
    [drafts],
  )

  const completion = React.useMemo(
    () => assessRunCompletion(items, currentAnswers, { spec: closingAct, act: closingAct ? closing : null }),
    [items, currentAnswers, closingAct, closing],
  )
  const summary = React.useMemo(() => summarizeCompliance(items, currentAnswers, scoringPolicy), [items, currentAnswers, scoringPolicy])
  const answeredCount = currentAnswers.length
  // I-02: mismo conjunto que exige `assessRunCompletion` — antes el contador
  // usaba sólo `item.required`, y 11 de 12 plantillas del catálogo no declaran
  // ninguno, así que decía "0 de N" sobre inspecciones ya terminadas.
  const requiredItems = React.useMemo(() => effectiveRequiredItems(items), [items])
  const answeredRequired = React.useMemo(() => requiredItems.filter((item) => drafts[draftKey(item.sectionId, item.itemId)]?.result).length, [requiredItems, drafts])

  // B-03: la misma regla que aplica el servicio, evaluada antes de enviar.
  // Sin esto el CHECK de Postgres reventaba el lote entero y el usuario veía
  // el texto crudo de la violación.
  const itemBySpec = React.useMemo(
    () => new Map(items.map((item) => [draftKey(item.sectionId, item.itemId), item])),
    [items],
  )
  const [savedAnswerRows, setSavedAnswerRows] = React.useState(answers)
  React.useEffect(() => { setSavedAnswerRows(answers) }, [answers])

  // La evidencia cuelga de la respuesta persistida. El mapa se actualiza con
  // las claves que devuelve el autosave, por lo que elegir una foto puede
  // crear la respuesta y subirla en el mismo gesto.
  const savedAnswers = React.useMemo(
    () => new Map(savedAnswerRows.map((answer) => [draftKey(answer.sectionId, answer.itemId), answer])),
    [savedAnswerRows],
  )
  const rowProblemEntries = React.useMemo(
    () => currentAnswers.flatMap((answer) => {
      const item = itemBySpec.get(draftKey(answer.sectionId, answer.itemId))
      if (!item) return []
      const problem = validateAnswerRow(item, answer)
      return problem ? [{ key: draftKey(answer.sectionId, answer.itemId), problem }] : []
    }),
    [currentAnswers, itemBySpec],
  )
  const rowProblems = React.useMemo(() => rowProblemEntries.map((entry) => entry.problem), [rowProblemEntries])
  const completionBlockers = React.useMemo(() => {
    const seen = new Set(rowProblems)
    return completion.blockers.filter((item) => {
      if (seen.has(item.detail)) return false
      seen.add(item.detail)
      return true
    })
  }, [completion.blockers, rowProblems])

  /** Payload compartido por guardar y por declarar ejecutada: un solo contrato. */
  function answersPayload() {
    return {
      runId: run.id,
      expectedVersion: version,
      answers: currentAnswers,
      locationLatitude: coords?.lat ?? null,
      locationLongitude: coords?.lon ?? null,
    }
  }

  /** Payload de completar: respuestas + acta, todo en una transacción. */
  function completePayload() {
    return {
      ...answersPayload(),
      closingAct: closingAct
        ? {
            result: closing.result,
            restrictions: closing.restrictions || null,
            signatures: closing.signatures.filter((item) => item.name.trim().length > 0),
          }
        : undefined,
    }
  }

  async function queueOffline() {
    const { queueInspectionSubmission } = await import("./offline-inspection-queue")
    try {
      /* INS-18/INS-19: el mismo payload que manda el cierre en línea, sin
       * recomponerlo a mano. Antes se omitía `needsConfirmation` —hoy inocuo
       * porque el gate del cliente ya exige ratificar antes de habilitar el
       * botón, pero era una divergencia esperando a que esa condición cambie—
       * y viajaba un `clientSubmissionId` que `completeInspectionRun` descarta:
       * su Zod no lo declara. La idempotencia del reintento la da el bloque
       * `alreadyCompleted` del servicio (mismo ejecutante + ya ejecutada), no
       * ese campo. */
      await queueInspectionSubmission({
        ...(completePayload() as unknown as Omit<OfflineInspectionSubmission, "runId">),
        runId: run.id,
      })
      setOfflineNote("Guardada en el dispositivo. Se enviará al recuperar conexión.")
      await refreshQueue()
    } catch (error) {
      setOfflineNote(error instanceof Error ? error.message : "No se pudo guardar en el dispositivo.")
    }
  }

  function applyVersion(result: { data?: Record<string, unknown> }) {
    const next = result.data?.version
    if (typeof next === "number") setVersion(next)
  }

  function applySavedAnswerRefs(result: { data?: Record<string, unknown> }) {
    applyVersion(result)
    const refs = result.data?.answerRefs
    if (!Array.isArray(refs)) return
    setSavedAnswerRows((current) => {
      const byKey = new Map(current.map((answer) => [draftKey(answer.sectionId, answer.itemId), answer]))
      for (const value of refs) {
        if (!value || typeof value !== "object") continue
        const row = value as { answerId?: unknown; sectionId?: unknown; itemId?: unknown }
        if (typeof row.answerId !== "string" || typeof row.sectionId !== "string" || typeof row.itemId !== "string") continue
        const key = draftKey(row.sectionId, row.itemId)
        const previous = byKey.get(key)
        byKey.set(key, previous
          ? { ...previous, answerId: row.answerId }
          : {
              answerId: row.answerId,
              sectionId: row.sectionId,
              itemId: row.itemId,
              result: drafts[key]?.result ?? "",
              comment: drafts[key]?.comment || null,
              value: drafts[key]?.value || null,
              evidence: [],
              needsConfirmation: drafts[key]?.needsConfirmation ?? false,
            })
      }
      return [...byKey.values()]
    })
  }

  async function ensureAnswerSaved(key: string) {
    if (rowProblems.length > 0) throw new Error("Corrige las respuestas marcadas antes de adjuntar fotografías.")
    const result = await saveInspectionAnswersAction(answersPayload())
    if (!result.ok) throw new Error(result.message ?? "No se pudo guardar la respuesta.")
    applySavedAnswerRefs(result)
    operation.setMessage("Respuesta guardada y lista para recibir evidencia.")
    const refs = result.data?.answerRefs
    if (!Array.isArray(refs)) throw new Error("El servidor no devolvió la respuesta guardada.")
    const target = refs.find((value) => {
      if (!value || typeof value !== "object") return false
      const row = value as { sectionId?: unknown; itemId?: unknown }
      return draftKey(String(row.sectionId ?? ""), String(row.itemId ?? "")) === key
    }) as { answerId?: unknown } | undefined
    if (typeof target?.answerId !== "string") throw new Error("No se encontró la respuesta guardada.")
    return target.answerId
  }

  function saveAnswers() {
    operation.run(() => saveInspectionAnswersAction(answersPayload()), applySavedAnswerRefs)
  }

  /* INS-02: espejo del borrador en el propio dispositivo. Se escribe en cada
   * edición, antes y con independencia del autoguardado: en terreno el envío
   * al servidor es justo lo que falla, y el espejo es lo único que sobrevive a
   * cerrar la pestaña sin señal. */
  React.useEffect(() => {
    if (!editable || revision === 0) return
    writeInspectionDraft(run.id, { version, savedAt: new Date().toISOString(), drafts })
  }, [editable, revision, drafts, run.id, version])

  /* Autoguardado contra el servidor, con el mismo camino de escritura que el
   * botón. Reusa el hook que ya usa el motor SST para sus checklists — hasta
   * ahora Inspecciones era el único que obligaba a acordarse de guardar, y es
   * el que se ejecuta en terreno con 54 y hasta 75 ítems por delante.
   *
   * No se autoguarda con respuestas inválidas: el servidor las rechazaría
   * igual y el hook reintentaría en bucle contra una guarda. */
  const autosave = useDebouncedAutosave({
    watchKey: revision,
    isDirty: revision > 0,
    onSave: () => saveInspectionAnswersAction(answersPayload()),
    onSaved: (result) => {
      applySavedAnswerRefs(result)
      // Persistido: el espejo dejó de tener nada que rescatar.
      clearInspectionDraft(run.id)
      setRestoredDraft(false)
    },
    enabled: editable && rowProblems.length === 0,
    debounceMs: 1200,
  })
  const savingAnswers = autosave.status === "saving"

  const facts = [
    { label: "Estado", value: inspectionTaskStatusLabel(run.status) },
    { label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
    { label: "Faena", value: worksiteName },
    { label: "Sujeto", value: run.subjectType ? `${inspectionSubjectTypeLabel(run.subjectType)}${run.subjectLabel ? ` · ${run.subjectLabel}` : ""}` : run.subjectLabel ?? "—" },
    { label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { label: "Programada para", value: run.scheduledFor ? formatDate(run.scheduledFor) : "Sin fecha" },
    { label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
    {
      label: "Resultado oficial",
      value: (run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints) === null
        ? "Sin fórmula en el documento"
        : `${(run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints)! / 100}%`,
    },
    {
      label: "Resultado normalizado",
      value: (run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints) === null
        ? "Aún no calculable"
        : `${(run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints)! / 100}%`,
    },
    { label: "Ubicación", value: coords ? `${coords.lat}, ${coords.lon} · dato de apoyo opcional` : "No capturada · opcional" },
    // Qué acredita en el programa anual, y en qué etapa. El estado del run dice
    // si ya ocurrió: `completed` cierra la primera, `reviewed` la segunda.
    {
      label: "Acredita en el PDTP",
      value: [
        pdtpActivityNumbers.length > 0 ? `N° ${pdtpActivityNumbers.join(", ")} al ejecutar` : null,
        pdtpReviewActivityNumbers.length > 0 ? `N° ${pdtpReviewActivityNumbers.join(", ")} al revisar` : null,
      ].filter(Boolean).join(" · ") || "No acredita ninguna actividad",
    },
  ]
  const isExecutor = run.executedByUserId === currentUserId
  const canCurrentUserReview = run.status === "completed" && canReview && !isExecutor
  // I-08: el bloqueo cubría sólo la auto-revisión. Quien ejecutó SIN permiso
  // de revisión (p. ej. el jefe de terreno) tampoco puede cerrarla y antes no
  // veía ningún mensaje — sólo cambia el copy según tenga o no el permiso.
  const reviewBlocked = run.status === "completed" && isExecutor
  const selfReviewBlocked = reviewBlocked && canReview
  const showMobileActionBar = editable || canCurrentUserReview

  // I-09: en modo revisión el trabajo es juzgar los hallazgos, no recorrer el
  // checklist entero para llegar a ellos — se adelantan antes de las
  // secciones. En modo edición se quedan al final (recién se están
  // generando). Es una regla de lectura (¿hay algo que revisar?), no de
  // permiso: cualquiera que abre una inspección terminada los quiere primero.
  const findingsFirst = !editable && (run.status === "completed" || run.status === "reviewed")
  const findingsSection = (run.status === "completed" || run.status === "reviewed") ? (
    <section id="hallazgos" className="scroll-mt-16 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Hallazgos ({findings.length})</h2>
        {findings.length > 0 && run.subjectResourceId && canRequestRecharge && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/solicitudes/nueva?tipo=otro&recursoEmergencia=${encodeURIComponent(run.subjectResourceId)}`}>
              Solicitar recarga
            </Link>
          </Button>
        )}
      </div>
      {findings.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin hallazgos: todos los ítems evaluables cumplieron.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hallazgo</TableHead>
                <TableHead>Criticidad</TableHead>
                <TableHead>Estado</TableHead>
                {(canExecute || canReview) && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((finding) => (
                <TableRow key={finding.id}>
                  <TableCell className="text-sm">{finding.description}</TableCell>
                  <TableCell><Badge variant={criticalityBadgeVariant(finding.criticality)}>{FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}</Badge></TableCell>
                  <TableCell className="text-sm">
                    {FINDING_STATUS_LABELS[finding.status] ?? finding.status}
                    {finding.capaActionId && (
                      <Link href={`/prevencion/capa/${finding.capaActionId}`} className="ml-2 text-xs underline">Ver CAPA</Link>
                    )}
                  </TableCell>
                  {(canExecute || canReview) && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canExecute && finding.status === "open" && <CapaDialog finding={finding} assignees={assignees} hasVehicle={!!run.subjectVehicleId} />}
                        {canStopVehicle && run.subjectVehicleId && ["high", "critical"].includes(finding.criticality) && (
                          <StopVehicleDialog finding={finding} subjectLabel={run.subjectLabel} />
                        )}
                        {/* B-06: cierre manual sólo para hallazgos sin CAPA.
                            Los que la tienen se cierran al verificar o
                            cerrar su acción, en la misma transacción. */}
                        {canReview && finding.status === "open" && !finding.capaActionId && (
                          <ReasonDialog
                            trigger="Cerrar"
                            title="Cerrar hallazgo"
                            description={finding.description}
                            action={(reason) => closeInspectionFindingAction({ findingId: finding.id, reason })}
                            variant="ghost-danger"
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  ) : null

  return (
    <div className={showMobileActionBar ? "space-y-6 pb-24 md:pb-0" : "space-y-6"}>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Trabajo actual</p>
            <p className="mt-1 text-base font-semibold">{worksiteName}{run.subjectLabel ? ` · ${run.subjectLabel}` : ""}</p>
          </div>
          <Badge variant={runStatusBadgeVariant(run.status)}>{inspectionTaskStatusLabel(run.status)}</Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div><span className="block text-[var(--color-text-subtle)]">Responsable</span><span className="mt-0.5 block font-medium">{assigneeName ?? "Sin asignar"}</span></div>
          {/* I-02: sin obligatorios efectivos (instrumento de un solo ítem de
              texto libre) "0 de N obligatorios" mentía igual que antes, sólo
              que al revés — se muestra el avance total en su lugar. */}
          <div>
            <span className="block text-[var(--color-text-subtle)]">{requiredItems.length > 0 ? "Avance obligatorio" : "Avance"}</span>
            <span className="mt-0.5 block font-medium">{requiredItems.length > 0 ? `${answeredRequired} de ${requiredItems.length}` : `${answeredCount} de ${items.length}`}</span>
          </div>
        </div>
        <details className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
          <summary className="cursor-pointer font-medium">Ver contexto completo</summary>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {facts.slice(1).map((fact) => <div key={fact.label}><dt className="text-xs text-[var(--color-text-subtle)]">{fact.label}</dt><dd className="mt-0.5 text-xs font-medium">{fact.value}</dd></div>)}
          </dl>
        </details>
      </section>

      <div className="hidden grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={runStatusBadgeVariant(run.status)}>{inspectionTaskStatusLabel(run.status)}</Badge>
          <span className="text-sm text-[var(--color-text-subtle)]">
            {requiredItems.length > 0 && `${answeredRequired} de ${requiredItems.length} obligatorios · `}
            {answeredCount} de {items.length} {requiredItems.length > 0 ? "totales" : "respondidos"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={operation.pending || geoState === "pending"}
              onClick={captureLocation}
            >
              {coords ? `Ubicación ${coords.lat}, ${coords.lon}` : geoState === "pending" ? "Ubicando…" : "Capturar ubicación"}
            </Button>
          )}
          {editable && (
            <>
              <Button className="hidden md:inline-flex" type="button" size="sm" variant="secondary" disabled={operation.pending || savingAnswers || rowProblems.length > 0} onClick={saveAnswers}>
                {savingAnswers ? "Guardando…" : "Guardar respuestas"}
              </Button>
              {/* INS-02: el autoguardado necesita decir en qué estado está, o
                  quien ejecuta no sabe si puede irse de la pantalla. */}
              <span role="status" className="hidden self-center text-xs text-[var(--color-text-subtle)] md:inline">
                {autosaveStatusLabel(autosave.status)}
              </span>
            </>
          )}
          {/* Función #3: el acta de LA inspección. El export Excel es agregado
              y en fiscalización se pide esta. */}
          {["completed", "reviewed"].includes(run.status) && (
            <Button asChild size="sm" variant="secondary">
              <a href={`/prevencion/inspecciones/${run.id}/print`} target="_blank" rel="noreferrer">Acta PDF</a>
            </Button>
          )}
          {editable && <span className="hidden md:inline-flex"><CompleteDialog run={run} completion={completion} rowProblems={rowProblems} payload={completePayload} onSaved={applyVersion} saving={savingAnswers} /></span>}
          {canCurrentUserReview && (
            <span className="hidden md:inline-flex"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} assignees={assignees} canExecute={canExecute} /></span>
          )}
          {/* A-05: rectificar una ejecución declarada por error. Antes no
              existía camino de vuelta y el dato quedaba firmado. */}
          {canReview && ["completed", "reviewed"].includes(run.status) && (
            <ReasonDialog
              trigger="Reabrir para rectificar"
              title={`Reabrir ${run.code}`}
              description="Vuelve la inspección a ejecución: borra el cumplimiento calculado y los hallazgos que no tengan CAPA. Los que ya tienen acción correctiva se conservan."
              action={(reason) => reopenInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
              onDone={applyVersion}
            />
          )}
          {/* A-04: cancelar una planificada que ya no corresponde. */}
          {canManage && ["planned", "in_progress", "completed"].includes(run.status) && (
            <ReasonDialog
              trigger="Cancelar"
              title={`Cancelar ${run.code}`}
              description="La inspección deja de estar pendiente y sale de la bandeja. No se puede deshacer."
              action={(reason) => cancelInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
              onDone={applyVersion}
              variant="ghost-danger"
            />
          )}
        </div>
      </div>

      {operation.message && <p role="status" className="rounded-lg border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-3 py-2 text-sm text-[var(--color-success-ink)] md:static">{operation.message}</p>}

      {/* INS-02: el borrador que sobrevivió en el dispositivo. Se dice, no se
          aplica en silencio: quien vuelve tiene que saber que lo que ve son sus
          respuestas sin enviar y no lo que el servidor tiene guardado. */}
      {restoredDraft && (
        <p role="status" className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          Se recuperaron respuestas sin enviar de este dispositivo. Se guardarán solas al recuperar conexión, o pulsa «Guardar respuestas».
        </p>
      )}

      {/* El hook reintenta solo, pero callarlo dejaría a alguien creyendo que
          su trabajo está a salvo cuando la faena no tiene señal. */}
      {autosave.error && (
        <p role="status" className="rounded-lg border border-[var(--color-danger-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm">
          {autosave.error} Tus respuestas siguen guardadas en este dispositivo.
        </p>
      )}

      {reviewBlocked && (
        <div className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          <p>
            {selfReviewBlocked
              ? "Tú ejecutaste esta inspección. Para conservar la revisión segregada, debe cerrarla otra persona con permiso de revisión."
              : "Ejecutaste esta inspección y no tienes permiso para revisarla. Debe cerrarla otra persona con permiso de revisión."}
            {reviewers.length > 0 && ` Puede cerrarla: ${reviewers.map((reviewer) => reviewer.name).join(", ")}.`}
          </p>
          {reviewers.length > 0 && <RemindReviewButton runId={run.id} />}
          {reviewers.length === 0 && <p className="mt-1">Nadie con permiso de revisión está asignado a esta faena. Avisa a Prevención.</p>}
        </div>
      )}

      {physicalSourceRequired && (
        <section className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div>
            <p className="text-eyebrow">Paso 1 · documento fuente</p>
            <h2 className="mt-1 text-base font-semibold">Transcribir el Reporte de Equipos</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">El jefe de faena carga y transcribe el registro físico del operador/mecánico. Prevención revisa y cierra después; no corresponde que quien transcribe se auto-revise.</p>
          </div>
          {canIngest && editable && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}
          {documents.length > 0 && <div className="lg:hidden"><SourceFormViewer documents={documents} /></div>}
        </section>
      )}

      {/* Función #9: en terreno la conexión falla justo cuando hay que cerrar
          la inspección. El envío queda en el dispositivo y se reintenta solo. */}
      {editable && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button type="button" size="sm" variant="ghost" onClick={() => void queueOffline()} disabled={operation.pending || !completion.allowed}>
            Encolar cierre en este dispositivo
          </Button>
          <span className="text-xs text-[var(--color-text-subtle)]">Sólo protege el cierre cuando ya está listo; no guarda fotografías ni planillas.</span>
          {queued > 0 && (
            <>
              <span className="text-[var(--color-text-subtle)]">1 cierre pendiente de sincronizar.</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => void flushQueue()}>Sincronizar</Button>
            </>
          )}
          {offlineNote && <span role="status">{offlineNote}</span>}
        </div>
      )}

      {editable && geoState === "denied" && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          No se pudo obtener la ubicación. La inspección se registra igual.
        </p>
      )}

      {editable && (rowProblemEntries.length > 0 || completionBlockers.length > 0) && (
        <div className="rounded-md border border-[var(--color-danger-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Corrige antes de guardar o declarar ejecutada:</p>
          {/* I-06: lista completa con scroll interno, no un "y N más…" mudo. */}
          <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-4">
            {rowProblemEntries.map((entry) => <li key={entry.key}>
              <button type="button" className="text-left underline" onClick={() => jumpToItem(entry.key)}>{entry.problem}</button>
            </li>)}
            {completionBlockers.map((item) => {
              const key = item.sectionId && item.itemId ? draftKey(item.sectionId, item.itemId) : null
              return (
                <li key={item.detail}>
                  {key ? <button type="button" className="text-left underline" onClick={() => jumpToItem(key)}>{item.detail}</button> : item.detail}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* I-09: ya no depende de `editable` — un índice de secciones sirve a
          cualquiera que lea el checklist, no sólo a quien ejecuta. */}
      {sections.length > 1 && (
        <nav aria-label="Secciones de la inspección" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto bg-[var(--color-bg)] px-1 py-2 md:static md:bg-transparent">
          {findingsFirst && findingsSection && (
            <a href="#hallazgos" className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium">Hallazgos ({findings.length})</a>
          )}
          {sections.map((section, index) => <a key={section.id} href={`#section-${section.id}`} className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium">{sectionNavLabel(section.title, index)}</a>)}
        </nav>
      )}

      {findingsFirst && findingsSection}

      <div className={documents.length > 0
        ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start"
        : undefined}
      >
        <div className="space-y-4">
        {sections.map((section, sectionIndex) => (
          <section key={section.id} id={`section-${section.id}`} className="scroll-mt-16 space-y-3">
            <p className="text-eyebrow">Sección {sectionIndex + 1} de {sections.length}</p>
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <div className="space-y-3 md:hidden">
              {section.items.map((item, itemIndex) => {
                const key = draftKey(section.id, item.id)
                const draft = drafts[key] ?? { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }
                // I-05: "No cumple" exige motivo igual que "No aplica"/"Regular" — es
                // el resultado que genera el hallazgo.
                const needsComment = draft.result === "not_applicable" || draft.result === "partial" || draft.result === "non_conforming"
                const scorable = fieldKindIsScorable(item.kind)
                return (
                  <article key={item.id} id={`item-mobile-${key}`} className="scroll-mt-28 space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold leading-snug">
                        {itemIndex + 1}. {item.matrix?.rowLabel ?? item.label}
                        {item.matrix && <span className="ml-2 text-xs font-medium text-[var(--color-text-subtle)]">{item.matrix.columnLabel}</span>}
                      </h3>
                      {item.required ? <Badge variant="outline">Obligatorio</Badge> : <span className="text-xs text-[var(--color-text-subtle)]">Opcional</span>}
                    </div>
                    {draft.needsConfirmation && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="warning">Leído de la planilla</Badge>
                        {editable && <Button type="button" size="sm" variant="secondary" onClick={() => confirmRead(section.id, item.id)}>Confirmar contra la foto</Button>}
                      </div>
                    )}
                    {scorable ? (
                      <>
                        <Field label="Resultado" required={item.required}>
                          {editable ? (
                            <Select value={draft.result || "__unset__"} onValueChange={(value) => update(section.id, item.id, { result: (value === "__unset__" ? "" : value) as ResultValue })}>
                              {/* I-13: color visible también mientras se edita, no sólo en el badge de lectura. */}
                              <SelectTrigger aria-label={`Resultado de ${item.label}`} className={resultSelectToneClass(draft.result)}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__unset__">Sin responder</SelectItem>
                                {/* INS-01: las opciones salen de la escala del ítem, no del
                                    mapa global. Ofrecer "No aplica" en un Anexo 13 dejaba
                                    sacar del denominador un ítem que el papel obliga a
                                    juzgar; y ahora la etiqueta es la del anexo ("Bueno"). */}
                                {inspectionResultOptionsFor(item.kind).map((option) => (
                                  <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : draft.result ? <Badge variant={resultBadgeVariant(draft.result)}>{inspectionResultLabel(item.kind, draft.result)}</Badge> : <span>Sin respuesta</span>}
                        </Field>
                        <Field label="Comentario" hint={needsComment ? `Obligatorio para "${inspectionResultLabel(item.kind, draft.result)}"; mínimo 3 caracteres.` : "Opcional, salvo que el resultado requiera justificación."}>
                          {editable ? <Textarea value={draft.comment} onChange={(event) => update(section.id, item.id, { comment: event.target.value })} rows={3} aria-label={`Comentario de ${item.label}`} /> : <p className="text-sm">{draft.comment || "Sin comentario"}</p>}
                        </Field>
                      </>
                    ) : (
                      <Field label="Respuesta" required={item.required}>
                        {editable ? <NonScorableField item={item} value={draft.value} onChange={(next) => update(section.id, item.id, { value: next, result: next.trim() ? "recorded" : "" })} />
                          // I-17: un ítem tipo fecha guarda ISO (YYYY-MM-DD); en lectura se formatea igual que el resto de la pantalla.
                          : <p className="whitespace-pre-wrap text-sm">{draft.value ? (item.kind === "date" ? formatDate(draft.value) : draft.value) : "Sin respuesta"}</p>}
                      </Field>
                    )}
                    <Field label="Evidencia fotográfica" hint="La foto queda vinculada a este ítem.">
                      <AnswerEvidence
                        answerId={savedAnswers.get(key)?.answerId ?? null}
                        evidence={savedAnswers.get(key)?.evidence ?? []}
                        editable={editable}
                        readyToPersist={draft.result !== ""}
                        ensureAnswerId={() => ensureAnswerSaved(key)}
                      />
                    </Field>
                  </article>
                )
              })}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border border-[var(--color-border)] md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ítem</TableHead>
                    <TableHead className="w-44">Resultado</TableHead>
                    <TableHead>Comentario</TableHead>
                    <TableHead className="w-44">Evidencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.items.map((item) => {
                    const key = draftKey(section.id, item.id)
                    const draft = drafts[key] ?? { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }
                    // 'Regular' exige justificarse por escrito igual que 'No aplica'
                    // — mismo criterio que el motor SST (requiresObservation).
                    // I-05: "No cumple" exige motivo igual que "No aplica"/"Regular" — es
                // el resultado que genera el hallazgo.
                const needsComment = draft.result === "not_applicable" || draft.result === "partial" || draft.result === "non_conforming"
                    // B-08: un ítem que no expresa conformidad se responde con
                    // su contenido. Antes se le ofrecía "Cumple / No cumple" y
                    // el texto no tenía dónde guardarse.
                    const scorable = fieldKindIsScorable(item.kind)
                    return (
                      <TableRow key={item.id} id={`item-desktop-${key}`} className="scroll-mt-20">
                        <TableCell className="text-sm">
                          {item.matrix ? (
                            <span><span className="font-medium">{item.matrix.rowLabel}</span><span className="ml-2 text-xs text-[var(--color-text-subtle)]">{item.matrix.columnLabel}</span></span>
                          ) : item.label}
                          {item.required && <Badge variant="outline" className="ml-2">Obligatorio</Badge>}
                          {draft.needsConfirmation && (
                            <span className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge variant="warning">Leído de la planilla</Badge>
                              {editable && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => confirmRead(section.id, item.id)}
                                >
                                  Confirmar contra la foto
                                </Button>
                              )}
                            </span>
                          )}
                        </TableCell>
                        {scorable ? (
                          <>
                            <TableCell>
                              {editable ? (
                                <Select value={draft.result || "__unset__"} onValueChange={(v) => update(section.id, item.id, { result: (v === "__unset__" ? "" : v) as ResultValue })}>
                                  <SelectTrigger aria-label={`Resultado de ${item.label}`}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__unset__">Sin responder</SelectItem>
                                    {inspectionResultOptionsFor(item.kind).map((option) => (
                                      <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : draft.result ? (
                                <Badge variant={resultBadgeVariant(draft.result)}>
                                  {inspectionResultLabel(item.kind, draft.result)}
                                </Badge>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              {editable ? (
                                <Input
                                  value={draft.comment}
                                  onChange={(event) => update(section.id, item.id, { comment: event.target.value })}
                                  // El motivo nombra el resultado como lo nombra el instrumento:
                                  // en un Anexo B/R/M pide "Motivo del Malo", no "del No cumple".
                                  placeholder={needsComment ? `Motivo del "${inspectionResultLabel(item.kind, draft.result)}" (mínimo 3 caracteres)` : "Opcional"}
                                  aria-label={`Comentario de ${item.label}`}
                                />
                              ) : (
                                <span className="text-sm text-[var(--color-text-subtle)]">{draft.comment || "—"}</span>
                              )}
                            </TableCell>
                          </>
                        ) : (
                          // El valor ES la respuesta, así que ocupa las dos
                          // columnas de conformidad: no hay nada que juzgar aparte.
                          <TableCell colSpan={2}>
                            {editable ? (
                              <NonScorableField
                                item={item}
                                value={draft.value}
                                onChange={(next) => update(section.id, item.id, {
                                  value: next,
                                  // El estado acompaña al contenido: sin valor
                                  // el ítem vuelve a "sin responder" y el
                                  // guardado lo borra (B-02).
                                  result: next.trim() ? "recorded" : "",
                                })}
                              />
                            ) : (
                              // I-17: mismo formato que el resto de la pantalla para un ítem tipo fecha.
                              <span className="text-sm whitespace-pre-wrap">{draft.value ? (item.kind === "date" ? formatDate(draft.value) : draft.value) : "—"}</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <AnswerEvidence
                            answerId={savedAnswers.get(key)?.answerId ?? null}
                            evidence={savedAnswers.get(key)?.evidence ?? []}
                            editable={editable}
                            readyToPersist={draft.result !== ""}
                            ensureAnswerId={() => ensureAnswerSaved(key)}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
        </div>
        {documents.length > 0 && (physicalSourceRequired
          ? <div className="hidden lg:block"><SourceFormViewer documents={documents} /></div>
          : <SourceFormViewer documents={documents} />)}
      </div>

      {/* Los instrumentos que no puntúan ítems registran lo que encontraron. La
          gravedad la trae el catálogo, así que el plazo de la acción correctiva
          no depende de quien está en terreno. */}
      {recordsDeviations && (
        <>
        {isUnplannedInspection && (
          <ParticipantsPanel runId={run.id} participants={participants} editable={editable && canExecute} />
        )}
        <DeviationsPanel
          runId={run.id}
          editable={editable}
          canExecute={canExecute}
          catalog={deviationCatalog}
          registered={findings.filter((finding) => finding.origin === "deviation")}
          narrative={isUnplannedInspection}
        />
        </>
      )}
      {recordsPreventiveActions && (
        <PreventiveActionsPanel runId={run.id} actions={findings.filter((finding) => finding.origin === "deviation")} assignees={assignees} editable={editable && canExecute} />
      )}

      {!physicalSourceRequired && canIngest && editable && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}

      {closingAct && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{closingAct.title}</h2>
          {editable ? (
            <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
              <Field label="Resultado" required>
                <Select value={closing.result || "__unset__"} onValueChange={(value) => setClosing((c) => ({ ...c, result: value === "__unset__" ? "" : value }))}>
                  <SelectTrigger aria-label="Resultado del acta"><SelectValue placeholder="Sin declarar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset__">Sin declarar</SelectItem>
                    {closingAct.resultOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {closingAct.hasRestrictions && (
                <Field label="Restricciones" hint="Opcional.">
                  <Textarea
                    value={closing.restrictions ?? ""}
                    onChange={(event) => setClosing((c) => ({ ...c, restrictions: event.target.value }))}
                    maxLength={3000}
                    aria-label="Restricciones del acta"
                  />
                </Field>
              )}
              {closing.signatures.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {closing.signatures.map((signature, index) => (
                    /* Sin `htmlFor` a propósito: el `Input` ya declara su
                     * `aria-label` abajo, y pasarlo haría que `Field` inyecte un
                     * `aria-labelledby` que lo pisa —el nombre accesible pasaría
                     * de "Firma de prevencionista" a "Firma: prevencionista"— y
                     * rompe a todo el que localice el campo por su nombre. */
                    <Field key={signature.role} label={`Firma: ${formatSignatureRole(signature.role)}`} hint="Nombre de quien firma.">
                      <Input
                        value={signature.name}
                        onChange={(event) => setClosing((c) => ({
                          ...c,
                          signatures: c.signatures.map((item, i) => i === index ? { ...item, name: event.target.value } : item),
                        }))}
                        maxLength={200}
                        aria-label={`Firma de ${formatSignatureRole(signature.role)}`}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-4 text-sm">
              <p>
                <span className="text-[var(--color-text-subtle)]">Resultado: </span>
                {closingAct.resultOptions.find((option) => option.value === run.closingResult)?.label ?? run.closingResult ?? "—"}
              </p>
              {run.closingRestrictions && <p><span className="text-[var(--color-text-subtle)]">Restricciones: </span>{run.closingRestrictions}</p>}
              {run.closingSignatures?.map((signature) => (
                <p key={signature.role}>
                  <span className="text-[var(--color-text-subtle)]">{formatSignatureRole(signature.role)}: </span>
                  {signature.name} · {formatDateTime(signature.signedAt)}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* I-09: en modo edición se quedan al final; en revisión ya se movieron
          justo después de la barra de secciones. */}
      {!findingsFirst && findingsSection}

      {run.status === "reviewed" && run.reviewComment && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Revisada {formatDateTime(run.reviewedAt!)} por {reviewerName ?? "—"}: {run.reviewComment}
        </p>
      )}

      {showMobileActionBar && (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)] md:hidden">
          {editable ? (
            <>
              <Button type="button" variant="secondary" disabled={operation.pending || savingAnswers || rowProblems.length > 0} onClick={saveAnswers}>{savingAnswers ? "Guardando…" : "Guardar"}</Button>
              <CompleteDialog run={run} completion={completion} rowProblems={rowProblems} payload={completePayload} onSaved={applyVersion} saving={savingAnswers} />
            </>
          ) : canCurrentUserReview ? (
            <div className="col-span-2"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} assignees={assignees} canExecute={canExecute} /></div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/* ── Desviaciones encontradas ─────────────────────────────────────────────
 * El panel de los instrumentos que no puntúan ítems: observación de conductas,
 * inspección de área y caminata de seguridad.
 *
 * Cada desviación se elige del catálogo del instrumento y de ahí sale su
 * gravedad — por eso el formulario NO ofrece elegirla en ese camino: si la
 * eligiera quien registra, el plazo de la acción correctiva dependería de su
 * criterio. La excepción es "Otra desviación", que existe porque forzar la
 * desviación más parecida ensucia el dato peor que no clasificarla; ésas quedan
 * en la cola que Prevención resuelve desde el creador.
 */

function PreventiveActionsPanel({ runId, actions, assignees, editable }: {
  runId: string
  actions: FindingInfo[]
  assignees: { id: string; name: string }[]
  editable: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  const [targetDate, setTargetDate] = React.useState("")
  const operation = useOperation()
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Acciones preventivas ({actions.length}/6)</h2>
      {editable && actions.length < 6 && <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Agregar acción</Button>}
    </div>
    {actions.length === 0 ? <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin acciones preventivas acordadas.</p> : <ol className="space-y-2">{actions.map((action, index) => <li key={action.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm"><span className="font-semibold">{index + 1}.</span> {action.description} {action.capaActionId && <Badge variant="success" className="ml-2">CAPA creada</Badge>}</li>)}</ol>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      const actionDescription = String(new FormData(event.currentTarget).get("actionDescription") ?? "")
      operation.run(() => registerInspectionPreventiveActionAction({ runId, actionDescription, responsibleUserId, targetDate }), () => setOpen(false))
    }}>
      <DialogHeader><DialogTitle>Acción preventiva</DialogTitle><DialogDescription>La acción quedará creada directamente en CAPA/PDTP con responsable y fecha de control.</DialogDescription></DialogHeader>
      <Field label="Acción acordada" required><Textarea name="actionDescription" required minLength={10} maxLength={3000} /></Field>
      <Field label="Responsable" required><Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger aria-label="Responsable de la acción"><SelectValue placeholder="Selecciona responsable" /></SelectTrigger><SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Fecha de control" required><DatePicker value={targetDate} onChange={setTargetDate} /></Field>
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending || !responsibleUserId || !targetDate}>Crear acción CAPA</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </section>
}

function ParticipantsPanel({ runId, participants, editable }: {
  runId: string
  participants: { id: string; name: string; position: string; userId: string | null }[]
  editable: boolean
}) {
  const [rows, setRows] = React.useState(() => participants.map(({ id, name, position, userId }) => ({ id, name, position, userId })))
  const operation = useOperation()

  function updateRow(index: number, patch: Partial<{ name: string; position: string }>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Participantes ({rows.length})</h2>
        {editable && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setRows((current) => [...current, { id: `participant-${Date.now()}-${current.length}`, name: "", position: "", userId: null }])}>
            Agregar participante
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
          Registra al menos una persona participante, con su nombre y cargo.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-[1fr_1fr_auto]">
              {editable ? (
                <>
                  <Field label={`Nombre ${index + 1}`} required><Input value={row.name} onChange={(event) => updateRow(index, { name: event.target.value })} /></Field>
                  <Field label="Cargo" required><Input value={row.position} onChange={(event) => updateRow(index, { position: event.target.value })} /></Field>
                  <Button type="button" size="sm" variant="ghost" className="self-end" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Quitar</Button>
                </>
              ) : (
                <p className="md:col-span-3"><span className="font-medium">{row.name}</span> · {row.position}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <Button
          type="button"
          size="sm"
          disabled={operation.pending || rows.length === 0 || rows.some((row) => row.name.trim().length < 2 || row.position.trim().length < 2)}
          onClick={() => operation.run(() => saveInspectionParticipantsAction({ runId, participants: rows }))}
        >
          {operation.pending ? "Guardando…" : "Guardar participantes"}
        </Button>
      )}
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
    </section>
  )
}

const DEVIATION_PLAZO: Record<string, string> = {
  critical: "3 días y detención",
  high: "7 días",
  medium: "15 días",
  low: "30 días",
}

function DeviationsPanel({ runId, editable, canExecute, catalog, registered, narrative }: {
  runId: string
  editable: boolean
  canExecute: boolean
  catalog: { id: string; label: string; danoPotencial: string; criticality: string }[]
  registered: FindingInfo[]
  narrative: boolean
}) {
  const [entryId, setEntryId] = React.useState("")
  const [otherOpen, setOtherOpen] = React.useState(false)
  const operation = useOperation()
  const puedeRegistrar = editable && canExecute

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Desviaciones encontradas ({registered.length})</h2>
        {puedeRegistrar && (
          <div className="flex flex-wrap items-center gap-2">
            {!narrative && catalog.length > 0 && (
              <>
                <Select value={entryId} onValueChange={setEntryId}>
                  <SelectTrigger className="w-72" aria-label="Desviación del catálogo">
                    <SelectValue placeholder="Elegir del catálogo…" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label} · {DEVIATION_PLAZO[entry.criticality] ?? entry.criticality}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={operation.pending || !entryId}
                  onClick={() => operation.run(
                    () => registerDeviationAction({ runId, catalogEntryId: entryId }),
                    () => setEntryId(""),
                  )}
                >
                  Registrar
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={() => setOtherOpen(true)}>
              {narrative ? "Registrar hallazgo" : "Otra desviación"}
            </Button>
          </div>
        )}
      </div>

      {!narrative && catalog.length === 0 && puedeRegistrar && (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
          Este instrumento aún no tiene catálogo de desviaciones. Prevención lo arma desde Inspecciones → Plantillas;
          mientras tanto se pueden registrar con «Otra desviación».
        </p>
      )}

      {registered.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
          Sin desviaciones registradas. Si la actividad se hizo y no encontró nada, declárala ejecutada así.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Desviación</TableHead>
                <TableHead>Criticidad</TableHead>
                <TableHead>Plazo de la acción</TableHead>
                <TableHead>Estado</TableHead>
                {puedeRegistrar && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {registered.map((finding) => (
                <React.Fragment key={finding.id}>
                <TableRow>
                  <TableCell className="text-sm">{finding.description}</TableCell>
                  <TableCell>
                    <Badge variant={criticalityBadgeVariant(finding.criticality)}>
                      {FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{DEVIATION_PLAZO[finding.criticality] ?? "—"}</TableCell>
                  <TableCell className="text-sm">{FINDING_STATUS_LABELS[finding.status] ?? finding.status}</TableCell>
                  {puedeRegistrar && (
                    <TableCell className="text-right">
                      {/* Quitar sólo mientras no tenga CAPA: con acción correctiva
                          enlazada ya hay trabajo colgando de ella. */}
                      {finding.capaActionId ? (
                        <span className="text-xs text-[var(--color-text-subtle)]">Con CAPA</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={operation.pending}
                          onClick={() => operation.run(() => removeDeviationAction({ findingId: finding.id }))}
                        >
                          Quitar
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                {narrative && (finding.potentialDamageDescription || finding.immediateMeasure || finding.applicableLaw) && (
                  <TableRow>
                    <TableCell colSpan={puedeRegistrar ? 5 : 4} className="bg-[var(--color-surface-2)] text-xs">
                      <dl className="grid gap-2 md:grid-cols-3">
                        <div><dt className="font-semibold">Daño potencial</dt><dd>{finding.potentialDamageDescription ?? "—"}</dd></div>
                        <div><dt className="font-semibold">Medida preventiva</dt><dd>{finding.immediateMeasure ?? "—"}</dd></div>
                        <div><dt className="font-semibold">Normativa</dt><dd>{finding.applicableLaw ?? "—"}</dd></div>
                      </dl>
                      <div className="mt-3"><FindingEvidence findingId={finding.id} evidence={finding.evidence} editable={puedeRegistrar} /></div>
                    </TableCell>
                  </TableRow>
                )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}

      <OtherDeviationDialog runId={runId} open={otherOpen} onOpenChange={setOtherOpen} narrative={narrative} />
    </section>
  )
}

/**
 * "Otra desviación": el único camino donde la gravedad la elige quien registra.
 * Queda sin entrada de catálogo, y por eso aparece en la cola de clasificación
 * del creador para que Prevención la incorpore con la gravedad oficial.
 */
function OtherDeviationDialog({ runId, open, onOpenChange, narrative }: {
  runId: string
  open: boolean
  onOpenChange: (next: boolean) => void
  narrative: boolean
}) {
  const [dano, setDano] = React.useState("moderado")
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const description = String(form.get("description") ?? "").trim()
            operation.run(
              () => registerDeviationAction({
                runId,
                description,
                danoPotencial: dano,
                potentialDamageDescription: narrative ? String(form.get("potentialDamageDescription") ?? "").trim() : undefined,
                immediateMeasure: narrative ? String(form.get("immediateMeasure") ?? "").trim() : undefined,
                applicableLaw: narrative ? String(form.get("applicableLaw") ?? "").trim() : undefined,
              }),
              () => onOpenChange(false),
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{narrative ? "Registrar hallazgo del Anexo 08" : "Otra desviación"}</DialogTitle>
            <DialogDescription>
              {narrative
                ? "Completa los antecedentes documentales del hallazgo. La clasificación interna determina la prioridad y el plazo CAPA."
                : "Para lo que no está en el catálogo. Prevención la revisará y, si corresponde, la incorporará con su gravedad oficial — hasta entonces rige la que elijas acá."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Qué se encontró" required>
            <Textarea name="description" required minLength={3} maxLength={3000} rows={3} aria-label="Descripción de la desviación" />
          </Field>
          {narrative && (
            <>
              <Field label="Descripción narrativa del daño potencial" required>
                <Textarea name="potentialDamageDescription" required minLength={3} maxLength={3000} rows={3} />
              </Field>
              <Field label="Medida preventiva" required>
                <Textarea name="immediateMeasure" required minLength={3} maxLength={3000} rows={3} />
              </Field>
              <Field label="Normativa legal aplicable" required>
                <Input name="applicableLaw" required minLength={2} maxLength={1000} />
              </Field>
            </>
          )}
          <Field label="Gravedad" required>
            <Select value={dano} onValueChange={setDano}>
              <SelectTrigger aria-label="Gravedad de la desviación"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="leve">Leve → bajo · 30 días</SelectItem>
                <SelectItem value="moderado">Moderado → medio · 15 días</SelectItem>
                <SelectItem value="grave">Grave → alto · 7 días</SelectItem>
                <SelectItem value="fatal">Fatal → crítico · 3 días y detención</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Registrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Declarar ejecutada ───────────────────────────────────────────────────── */

/**
 * B-01: el envío incluye el conjunto de respuestas en pantalla, y el servicio
 * lo persiste y completa en la misma transacción.
 *
 * Antes, este diálogo sólo llamaba a completar: el gate se evaluaba contra el
 * borrador en memoria mientras el servidor puntuaba lo último guardado. Un
 * inspector que corregía tres ítems y pulsaba "Declarar ejecutada" sin volver a
 * guardar firmaba cumplimiento y hallazgos con los valores viejos, sin aviso.
 */
function CompleteDialog({ run, completion, rowProblems, payload, onSaved, saving = false }: {
  run: RunInfo
  completion: { allowed: boolean; blockers: { kind: string; detail: string }[] }
  rowProblems: string[]
  payload: () => Record<string, unknown>
  onSaved: (result: { data?: Record<string, unknown> }) => void
  /** Autoguardado en vuelo: cerrar ahora mandaría un `expectedVersion` viejo. */
  saving?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const blocked = !completion.allowed || rowProblems.length > 0 || saving

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Declarar ejecutada</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(() => completeInspectionRunAction(payload()), (result) => {
              onSaved(result)
              // Declarada ejecutada: el borrador del dispositivo ya no aplica.
              clearInspectionDraft(run.id)
              setOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Declarar ejecutada {run.code}</DialogTitle>
            <DialogDescription>
              Guarda las respuestas en pantalla, calcula el cumplimiento y materializa un hallazgo por cada incumplimiento.
            </DialogDescription>
          </DialogHeader>
          {rowProblems.length > 0 && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">Respuestas inválidas:</p>
              <ul className="list-disc space-y-1 pl-4">
                {rowProblems.slice(0, 10).map((problem) => <li key={problem}>{problem}</li>)}
                {rowProblems.length > 10 && <li>y {rowProblems.length - 10} más…</li>}
              </ul>
            </div>
          )}
          {!completion.allowed && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede completar:</p>
              <ul className="list-disc space-y-1 pl-4">
                {completion.blockers.slice(0, 10).map((item) => <li key={item.detail}>{item.detail}</li>)}
                {completion.blockers.length > 10 && <li>y {completion.blockers.length - 10} más…</li>}
              </ul>
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          {saving && <p className="text-sm text-[var(--color-text-subtle)]">Guardando las últimas respuestas…</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || blocked}>Declarar ejecutada</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Derivar hallazgo a CAPA ──────────────────────────────────────────────── */

function CapaDialog({ finding, assignees, hasVehicle }: {
  finding: FindingInfo
  assignees: { id: string; name: string }[]
  hasVehicle: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  // Sólo tiene sentido con un equipo de flota como sujeto; el servicio lo
  // rechaza igual, pero ofrecerlo sin equipo sería un botón que siempre falla.
  const [createMaintenance, setCreateMaintenance] = React.useState(false)
  const operation = useOperation()
  const capaRule = capaPriorityForCriticality(finding.criticality)
  const targetDate = addDays(todayInChile(), capaRule.dueInDays)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const responsibleUserId = String(form.get("responsibleUserId") ?? "").trim()
    const immediateMeasure = String(form.get("immediateMeasure") ?? "").trim()
    operation.run(() => createFindingCapaAction({
      findingId: finding.id,
      actionDescription: form.get("actionDescription"),
      responsibleUserId,
      immediateMeasure: immediateMeasure || null,
      createMaintenance: hasVehicle && createMaintenance,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Derivar a CAPA</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Derivar hallazgo a CAPA</DialogTitle>
            <DialogDescription>{finding.description}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
            <div><span className="block text-xs text-[var(--color-text-subtle)]">Gravedad</span><Badge className="mt-1" variant={criticalityBadgeVariant(finding.criticality)}>{FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}</Badge></div>
            {/* I-24: "Compromiso automático" no explicaba por qué ese plazo — es
                política según gravedad, no un dato libre; se mantiene no editable. */}
            <div><span className="block text-xs text-[var(--color-text-subtle)]">Plazo según gravedad</span><span className="mt-1 block font-semibold">{capaRule.dueInDays} días · {formatDate(targetDate)}</span></div>
            {capaRule.requiresImmediateStop && <p className="col-span-2 text-xs font-medium text-[var(--color-danger-ink)]">La criticidad exige detener de inmediato la tarea o el equipo afectado.</p>}
          </div>
          <Field label="Acción correctiva" hint="Mínimo 10 caracteres.">
            <Textarea name="actionDescription" required minLength={10} maxLength={3000} />
          </Field>
          {/* I-24: el único campo obligatorio del formulario iba después de uno
              opcional, y sin asterisco. */}
          <Field label="Responsable" required hint="Debe quedar una persona a cargo antes de derivar.">
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger aria-label="Responsable de la CAPA"><SelectValue placeholder="Selecciona responsable" /></SelectTrigger><SelectContent>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="responsibleUserId" value={responsibleUserId} />
          </Field>
          <Field label="Medida inmediata" hint="Opcional.">
            <Textarea name="immediateMeasure" maxLength={3000} />
          </Field>
          {hasVehicle && (
            <div className="space-y-1">
              <Checkbox
                checked={createMaintenance}
                onChange={(event) => setCreateMaintenance(event.target.checked)}
                label="Programar mantención del equipo"
              />
              <p className="pl-6 text-xs text-[var(--color-text-subtle)]">
                Abre una mantención correctiva para el plazo de esta acción. Al completarla, queda como evidencia de la CAPA.
              </p>
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !responsibleUserId}>Derivar con responsable</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Confirma la propuesta de sacar el equipo de servicio.
 *
 * Es un diálogo aparte y no una casilla del anterior porque detener un equipo
 * para la faena: lo decide quien administra la flota, no quien digita el
 * reporte, y exige dejar dicho por qué.
 */
function StopVehicleDialog({ finding, subjectLabel }: { finding: FindingInfo; subjectLabel: string | null }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => stopVehicleForFindingAction({
      findingId: finding.id,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Sacar de servicio</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Sacar el equipo de servicio</DialogTitle>
            <DialogDescription>
              {subjectLabel ? `${subjectLabel} — ` : ""}{finding.description}
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres. Queda en el historial del equipo.">
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Confirmar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── La planilla física ───────────────────────────────────────────────────── */

/**
 * Visor de la planilla, a la derecha de las respuestas.
 *
 * La foto se queda a la vista mientras se recorren los ítems, y se amplía y
 * reduce para poder ir al detalle de una celda sin perder la lista. Es la
 * condición para que ratificar lo que leyó la máquina sea un acto real y no un
 * clic a ciegas: sin la imagen al lado, confirmar es adivinar.
 *
 * `position: sticky` sólo desde `lg`: en móvil las dos columnas se apilan y
 * fijar la imagen taparía media pantalla.
 */
function SourceFormViewer({ documents }: { documents: RunDocumentInfo[] }) {
  const [index, setIndex] = React.useState(0)
  const [zoom, setZoom] = React.useState(1)
  const current = documents[Math.min(index, documents.length - 1)]
  if (!current) return null
  const src = `/api/prevencion/inspecciones/documento/${current.path.split("/").pop()}`
  const isPdf = current.path.toLowerCase().endsWith(".pdf")

  return (
    <aside className="space-y-2 lg:sticky lg:top-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Planilla original</h2>
        {!isPdf && <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" aria-label="Reducir la planilla"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>−</Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-[var(--color-text-subtle)]">
            {Math.round(zoom * 100)}%
          </span>
          <Button type="button" size="sm" variant="ghost" aria-label="Ampliar la planilla"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}>+</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setZoom(1)}>Ajustar</Button>
        </div>}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        {isPdf ? (
          <object data={src} type="application/pdf" className="h-[60dvh] min-h-96 w-full" aria-label={current.caption ?? "Planilla PDF del reporte de equipos"}>
            <p className="p-4 text-sm">Este navegador no puede mostrar el PDF. <a className="underline" href={src} target="_blank" rel="noreferrer">Abrir documento</a>.</p>
          </object>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autorizada por sesión; no pasa por el optimizador */
          <img
            src={src}
            alt={current.caption ?? "Planilla del reporte de equipos"}
            className="origin-top-left"
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          />
        )}
      </div>
      {documents.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {documents.map((item, position) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={position === index ? "secondary" : "ghost"}
              onClick={() => { setIndex(position); setZoom(1) }}
            >
              Hoja {position + 1}
            </Button>
          ))}
        </div>
      )}
      {current.caption && <p className="text-xs text-[var(--color-text-subtle)]">{current.caption}</p>}
    </aside>
  )
}

/** Sube la foto de la planilla. Requiere `prevention:inspections:ingest`. */
function SourceFormUpload({ runId, hasDocuments }: { runId: string; hasDocuments: boolean }) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState("")

  async function upload(file: File) {
    setPending(true)
    setMessage("")
    try {
      const body = new FormData()
      body.append("file", file)
      body.append("runId", runId)
      const response = await fetch("/api/prevencion/inspecciones/documento", { method: "POST", body })
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw new Error(failure?.error ?? "No se pudo subir la planilla.")
      }
      /* INS-10: `router.refresh()` en una ruta con `loading.tsx` vuelve a
       * suspender, y React puede desmontar el árbol de cliente y montar uno
       * nuevo — el borrador en `useState` se iría con él. Lo que sostiene la
       * promesa de abajo no es el refresh: es el espejo en el dispositivo
       * (`inspection-draft-storage`), que se restaura al volver a montar. */
      setMessage("Planilla cargada. Tu borrador de respuestas se conserva.")
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir la planilla.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] p-4">
      <h2 className="text-sm font-semibold">{hasDocuments ? "Agregar otra hoja" : "Subir la planilla física"}</h2>
      <p className="text-xs text-[var(--color-text-subtle)]">
        Foto o escaneo del reporte firmado. Queda como evidencia del turno y sirve de referencia para responder los ítems.
      </p>
      <input
        ref={inputRef}
        type="file"
        aria-label={hasDocuments ? "Agregar otra hoja del reporte físico" : "Subir la planilla física"}
        accept="image/jpeg,image/png,application/pdf,.docx,.xlsx,.xls"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ""
        }}
      />
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? "Subiendo…" : "Elegir archivo"}
      </Button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  )
}

/* ── Revisar y cerrar ─────────────────────────────────────────────────────── */

function ReviewDialog({ run, findings, currentUserId, version, assignees, canExecute }: {
  run: RunInfo
  findings: FindingInfo[]
  currentUserId: string
  /** Versión vigente del run: desde C-02 el guardado la avanza, así que las props pueden estar atrasadas. */
  version: number
  /** I-07: para poder derivar a CAPA sin salir del diálogo de revisión. */
  assignees: { id: string; name: string }[]
  canExecute: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const review = React.useMemo(() => assessRunReview({
    executedByUserId: run.executedByUserId,
    reviewerUserId: currentUserId,
    findings: findings.map((item) => ({ id: item.id, description: item.description, criticality: item.criticality, capaActionId: item.capaActionId })),
  }), [run.executedByUserId, currentUserId, findings])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Revisar y cerrar{!review.allowed ? ` · ${review.blockers.length} bloqueo(s)` : ""}</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => reviewInspectionRunAction({
              runId: run.id,
              expectedVersion: version,
              reviewComment: form.get("reviewComment"),
            }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Revisar y cerrar {run.code}</DialogTitle>
            <DialogDescription>Exige independencia de quien ejecutó y que todo hallazgo alto o crítico tenga CAPA enlazada.</DialogDescription>
          </DialogHeader>
          {!review.allowed && (
            <div className="space-y-2 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede cerrar:</p>
              <ul className="list-disc space-y-2 pl-4">
                {review.blockers.map((item) => {
                  // I-07: el bloqueador trae el hallazgo que falta derivar — se
                  // ofrece el mismo diálogo de CAPA ACÁ, anidado, sin cerrar
                  // este (el comentario de revisión es un textarea no
                  // controlado y se perdería si se desmontara el diálogo).
                  const finding = item.findingId ? findings.find((f) => f.id === item.findingId) : undefined
                  return (
                    <li key={item.detail} className="flex flex-wrap items-center gap-2">
                      <span>{item.detail}</span>
                      {finding && (canExecute
                        ? <CapaDialog finding={finding} assignees={assignees} hasVehicle={!!run.subjectVehicleId} />
                        : <a href="#hallazgos" className="text-xs underline">Ver en Hallazgos</a>)}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <Field label="Comentario de revisión" hint="Mínimo 10 caracteres.">
            <Textarea name="reviewComment" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !review.allowed}>Revisar y cerrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
