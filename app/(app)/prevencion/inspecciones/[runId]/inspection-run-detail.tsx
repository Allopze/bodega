"use client"

import * as React from "react"
import Link from "next/link"
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
  criticalityBadgeVariant,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  INSPECTION_RESULT_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
  fieldKindAcceptsPartial,
  fieldKindIsScorable,
  resultBadgeVariant,
  runStatusBadgeVariant,
  summarizeCompliance,
  validateAnswerRow,
  type ClosingActInput,
  type ClosingActSpec,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { FieldKind } from "@/lib/sst/types"
import { formatDateTime } from "@/lib/utils"
import {
  cancelInspectionRunAction,
  closeInspectionFindingAction,
  completeInspectionRunAction,
  createFindingCapaAction,
  reopenInspectionRunAction,
  reviewInspectionRunAction,
  saveInspectionAnswersAction,
  stopVehicleForFindingAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { compressPhoto } from "@/lib/pwa/image-compress"

interface RunInfo {
  id: string
  code: string
  status: string
  origin: string
  subjectType: string | null
  subjectLabel: string | null
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
  executedByUserId: string | null
  closingResult: string | null
  closingRestrictions: string | null
  closingSignatures: { role: string; name: string; userId: string | null; signedAt: string }[] | null
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
  worksiteName: string
  assigneeName: string | null
  executorName: string | null
  reviewerName: string | null
  sections: SectionInfo[]
  answers: AnswerInfo[]
  findings: FindingInfo[]
  currentUserId: string
  assignees: { id: string; name: string }[]
  canExecute: boolean
  canReview: boolean
  canManage: boolean
  /** `combustibles:manage_vehicles`: confirma sacar el equipo de servicio. */
  canStopVehicle: boolean
  /** Planillas físicas adjuntas al run. */
  documents: RunDocumentInfo[]
  /** `prevention:inspections:ingest`: sube la foto de la planilla. */
  canIngest: boolean
  /** Acta que declara la plantilla; `null` si no exige uno. */
  closingAct: ClosingActSpec | null
}

function draftKey(sectionId: string, itemId: string) {
  return `${sectionId}::${itemId}`
}

/**
 * Diálogo genérico de "acción con motivo obligatorio": cancelar, reabrir,
 * cerrar hallazgo. Las tres son la misma interacción, y el servicio exige el
 * mismo mínimo de 10 caracteres en todas.
 */
function ReasonDialog({ trigger, title, description, action, onDone, variant = "ghost", confirmLabel }: {
  trigger: string
  title: string
  description: string
  action: (reason: string) => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }>
  onDone?: (result: { data?: Record<string, unknown> }) => void
  variant?: "ghost" | "secondary"
  confirmLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={variant}>{trigger}</Button></DialogTrigger>
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
function AnswerEvidence({ answerId, evidence, editable }: {
  answerId: string | null
  evidence: { id: string; path: string; caption: string | null }[]
  editable: boolean
}) {
  const [items, setItems] = React.useState(evidence)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  React.useEffect(() => { setItems(evidence) }, [evidence])

  async function upload(files: FileList | null) {
    if (!files?.length || !answerId) return
    setBusy(true)
    setError("")
    try {
      // Secuencial y no en paralelo: en terreno la conexión es escasa y varias
      // subidas simultáneas se estorban entre sí.
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("answerId", answerId)
        const response = await fetch("/api/prevencion/inspecciones/evidence", { method: "POST", body })
        const json = await response.json()
        if (!response.ok) throw new Error(json.error ?? "No se pudo subir la foto.")
        setItems((current) => [...current, { id: json.id, path: json.path, caption: null }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.")
    } finally {
      setBusy(false)
    }
  }

  const fileName = (path: string) => path.split("/").pop() ?? ""

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <a
              key={item.id}
              href={`/api/prevencion/inspecciones/evidence/${fileName(item.path)}`}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autenticada; next/image no aporta aquí. */}
              <img
                src={`/api/prevencion/inspecciones/evidence/${fileName(item.path)}`}
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
            type="file"
            accept="image/*"
            multiple
            disabled={!answerId || busy}
            onChange={(event) => { void upload(event.target.files); event.target.value = "" }}
            aria-label="Adjuntar evidencia fotográfica"
            className="text-xs"
          />
          {!answerId && <p className="text-xs text-[var(--color-text-subtle)]">Guarda la respuesta para adjuntar fotos.</p>}
          {busy && <p className="text-xs text-[var(--color-text-subtle)]">Subiendo…</p>}
          {error && <p role="status" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
        </>
      )}
    </div>
  )
}

export function InspectionRunDetail({
  run, templateKind, worksiteName, assigneeName, executorName, reviewerName,
  sections, answers, findings, currentUserId, assignees, canExecute, canReview, canManage, canStopVehicle,
  documents, canIngest, closingAct,
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

  const [coords, setCoords] = React.useState<{ lat: string; lon: string } | null>(null)
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
    else if (result.rejected > 0) setOfflineNote("La sincronización fue rechazada; revisa los datos.")
    await refreshQueue()
  }, [refreshQueue])

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
  const summary = React.useMemo(() => summarizeCompliance(items, currentAnswers), [items, currentAnswers])
  const answeredCount = currentAnswers.length

  // B-03: la misma regla que aplica el servicio, evaluada antes de enviar.
  // Sin esto el CHECK de Postgres reventaba el lote entero y el usuario veía
  // el texto crudo de la violación.
  const itemBySpec = React.useMemo(
    () => new Map(items.map((item) => [draftKey(item.sectionId, item.itemId), item])),
    [items],
  )
  // La evidencia cuelga de la respuesta persistida: sin `answerId` no hay dónde
  // colgarla, y por eso el control de subida se deshabilita hasta guardar.
  const savedAnswers = React.useMemo(
    () => new Map(answers.map((answer) => [draftKey(answer.sectionId, answer.itemId), answer])),
    [answers],
  )
  const rowProblems = React.useMemo(
    () => currentAnswers.flatMap((answer) => {
      const item = itemBySpec.get(draftKey(answer.sectionId, answer.itemId))
      if (!item) return []
      const problem = validateAnswerRow(item, answer)
      return problem ? [problem] : []
    }),
    [currentAnswers, itemBySpec],
  )

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
    const { queueInspectionSubmission, createInspectionSubmissionId } = await import("./offline-inspection-queue")
    try {
      await queueInspectionSubmission({
        clientSubmissionId: createInspectionSubmissionId(),
        runId: run.id,
        expectedVersion: version,
        answers: currentAnswers.map((answer) => ({
          sectionId: answer.sectionId,
          itemId: answer.itemId,
          result: answer.result,
          value: answer.value ?? null,
          comment: answer.comment ?? null,
        })),
        locationLatitude: coords?.lat ?? null,
        locationLongitude: coords?.lon ?? null,
        closingAct: closingAct
          ? {
              result: closing.result,
              restrictions: closing.restrictions || null,
              signatures: closing.signatures.filter((item) => item.name.trim().length > 0),
            }
          : undefined,
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

  function saveAnswers() {
    operation.run(() => saveInspectionAnswersAction(answersPayload()), applyVersion)
  }

  const facts = [
    { label: "Estado", value: INSPECTION_RUN_STATUS_LABELS[run.status] ?? run.status },
    { label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
    { label: "Faena", value: worksiteName },
    { label: "Sujeto", value: run.subjectType ? `${run.subjectType}${run.subjectLabel ? ` · ${run.subjectLabel}` : ""}` : run.subjectLabel ?? "—" },
    { label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { label: "Programada para", value: run.scheduledFor ?? "—" },
    { label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
    { label: "Cumplimiento", value: run.compliancePercent === null ? (summary.compliancePercent === null ? "No calculable" : `${summary.compliancePercent}% (previsto)`) : `${run.compliancePercent}%` },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={runStatusBadgeVariant(run.status)}>{INSPECTION_RUN_STATUS_LABELS[run.status] ?? run.status}</Badge>
          <span className="text-sm text-[var(--color-text-subtle)]">{answeredCount} de {items.length} ítems respondidos</span>
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
            <Button type="button" size="sm" variant="secondary" disabled={operation.pending || rowProblems.length > 0} onClick={saveAnswers}>
              Guardar respuestas
            </Button>
          )}
          {/* Función #3: el acta de LA inspección. El export Excel es agregado
              y en fiscalización se pide esta. */}
          {["completed", "reviewed"].includes(run.status) && (
            <Button asChild size="sm" variant="secondary">
              <a href={`/prevencion/inspecciones/${run.id}/print`} target="_blank" rel="noreferrer">Acta PDF</a>
            </Button>
          )}
          {editable && <CompleteDialog run={run} completion={completion} rowProblems={rowProblems} payload={completePayload} onSaved={applyVersion} />}
          {run.status === "completed" && canReview && (
            <ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} />
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
            />
          )}
        </div>
      </div>

      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}

      {/* Función #9: en terreno la conexión falla justo cuando hay que cerrar
          la inspección. El envío queda en el dispositivo y se reintenta solo. */}
      {editable && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button type="button" size="sm" variant="ghost" onClick={() => void queueOffline()} disabled={operation.pending || !completion.allowed}>
            Guardar sin conexión
          </Button>
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

      {editable && rowProblems.length > 0 && (
        <div className="rounded-md border border-[var(--color-danger-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Corrige antes de guardar:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {rowProblems.slice(0, 8).map((problem) => <li key={problem}>{problem}</li>)}
            {rowProblems.length > 8 && <li>y {rowProblems.length - 8} más…</li>}
          </ul>
        </div>
      )}

      {editable && !completion.allowed && (
        <div className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Aún no puede declararse ejecutada:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {completion.blockers.slice(0, 8).map((item) => <li key={item.detail}>{item.detail}</li>)}
            {completion.blockers.length > 8 && <li>y {completion.blockers.length - 8} más…</li>}
          </ul>
        </div>
      )}

      <div className={documents.length > 0
        ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start"
        : undefined}
      >
        <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
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
                    const needsComment = draft.result === "not_applicable" || draft.result === "partial"
                    // B-08: un ítem que no expresa conformidad se responde con
                    // su contenido. Antes se le ofrecía "Cumple / No cumple" y
                    // el texto no tenía dónde guardarse.
                    const scorable = fieldKindIsScorable(item.kind)
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">
                          {item.label}
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
                                    {Object.entries(INSPECTION_RESULT_LABELS)
                                      .filter(([value]) => value !== "recorded")
                                      .filter(([value]) => value !== "partial" || fieldKindAcceptsPartial(item.kind))
                                      .map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              ) : draft.result ? (
                                <Badge variant={resultBadgeVariant(draft.result)}>
                                  {INSPECTION_RESULT_LABELS[draft.result] ?? draft.result}
                                </Badge>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              {editable ? (
                                <Input
                                  value={draft.comment}
                                  onChange={(event) => update(section.id, item.id, { comment: event.target.value })}
                                  placeholder={needsComment ? (draft.result === "partial" ? "Motivo del Regular (mínimo 3 caracteres)" : "Motivo por el que no aplica (mínimo 3 caracteres)") : "Opcional"}
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
                              <span className="text-sm whitespace-pre-wrap">{draft.value || "—"}</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <AnswerEvidence
                            answerId={savedAnswers.get(key)?.answerId ?? null}
                            evidence={savedAnswers.get(key)?.evidence ?? []}
                            editable={editable}
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
        {documents.length > 0 && <SourceFormViewer documents={documents} />}
      </div>

      {canIngest && editable && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}

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
                    <Field key={signature.role} label={`Firma: ${signature.role}`} hint="Nombre de quien firma.">
                      <Input
                        value={signature.name}
                        onChange={(event) => setClosing((c) => ({
                          ...c,
                          signatures: c.signatures.map((item, i) => i === index ? { ...item, name: event.target.value } : item),
                        }))}
                        maxLength={200}
                        aria-label={`Firma de ${signature.role}`}
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
                  <span className="text-[var(--color-text-subtle)]">{signature.role}: </span>
                  {signature.name} · {formatDateTime(signature.signedAt)}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {(run.status === "completed" || run.status === "reviewed") && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Hallazgos ({findings.length})</h2>
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
                    {canExecute && <TableHead className="text-right">Acción</TableHead>}
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
      )}

      {run.status === "reviewed" && run.reviewComment && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Revisada {formatDateTime(run.reviewedAt!)} por {reviewerName ?? "—"}: {run.reviewComment}
        </p>
      )}
    </div>
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
function CompleteDialog({ run, completion, rowProblems, payload, onSaved }: {
  run: RunInfo
  completion: { allowed: boolean; blockers: { kind: string; detail: string }[] }
  rowProblems: string[]
  payload: () => Record<string, unknown>
  onSaved: (result: { data?: Record<string, unknown> }) => void
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const blocked = !completion.allowed || rowProblems.length > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Declarar ejecutada</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(() => completeInspectionRunAction(payload()), (result) => {
              onSaved(result)
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
  const [responsibleUserId, setResponsibleUserId] = React.useState("_none")
  // Sólo tiene sentido con un equipo de flota como sujeto; el servicio lo
  // rechaza igual, pero ofrecerlo sin equipo sería un botón que siempre falla.
  const [createMaintenance, setCreateMaintenance] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const responsibleUserId = String(form.get("responsibleUserId") ?? "").trim()
    const immediateMeasure = String(form.get("immediateMeasure") ?? "").trim()
    operation.run(() => createFindingCapaAction({
      findingId: finding.id,
      actionDescription: form.get("actionDescription"),
      responsibleUserId: responsibleUserId || null,
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
          <Field label="Acción correctiva" hint="Mínimo 3 caracteres.">
            <Textarea name="actionDescription" required minLength={3} maxLength={3000} />
          </Field>
          <Field label="Medida inmediata" hint="Opcional.">
            <Textarea name="immediateMeasure" maxLength={3000} />
          </Field>
          <Field label="Responsable" hint="Opcional.">
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin asignar</SelectItem>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="responsibleUserId" value={responsibleUserId === "_none" ? "" : responsibleUserId} />
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
          <DialogFooter><Button type="submit" disabled={operation.pending}>Derivar</Button></DialogFooter>
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

  return (
    <aside className="space-y-2 lg:sticky lg:top-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Planilla original</h2>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" aria-label="Reducir la planilla"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>−</Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-[var(--color-text-subtle)]">
            {Math.round(zoom * 100)}%
          </span>
          <Button type="button" size="sm" variant="ghost" aria-label="Ampliar la planilla"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}>+</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setZoom(1)}>Ajustar</Button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autorizada por sesión; no pasa por el optimizador */}
        <img
          src={src}
          alt={current.caption ?? "Planilla del reporte de equipos"}
          className="origin-top-left"
          style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
        />
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
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? "No se pudo subir la planilla.")
      // La planilla la lee el servidor al renderizar el detalle.
      window.location.reload()
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
        accept="image/jpeg,image/png,application/pdf"
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

function ReviewDialog({ run, findings, currentUserId, version }: {
  run: RunInfo
  findings: FindingInfo[]
  currentUserId: string
  /** Versión vigente del run: desde C-02 el guardado la avanza, así que las props pueden estar atrasadas. */
  version: number
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
      <DialogTrigger asChild><Button size="sm" variant="secondary">Revisar y cerrar</Button></DialogTrigger>
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
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede cerrar:</p>
              <ul className="list-disc space-y-1 pl-4">{review.blockers.map((item) => <li key={item.detail}>{item.detail}</li>)}</ul>
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
