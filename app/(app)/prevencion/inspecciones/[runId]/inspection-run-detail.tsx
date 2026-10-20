"use client"

import * as React from "react"
import {
  assessRunCompletion,
  effectiveRequiredItems,
  reviewerIsExecutorOfRecord,
  summarizeCompliance,
  type ClosingActSpec,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { normalizeAnswer, summarizeCompletion } from "@/lib/prevention/inspection-capture"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import type {
  RunInfo,
  SectionInfo,
  AnswerInfo,
  FindingInfo,
  RunDocumentInfo,
} from "./_components/types"
import { RunCaptureView } from "./_components/run-capture-view"
import { RunReadView } from "./_components/run-read-view"
import { publishRunVersion } from "./_components/run-live-version"
import { draftKey, jumpToItem } from "./_components/run-view-helpers"
import type { RunViewModel } from "./_components/run-view-types"
import { useGeolocation } from "./_hooks/use-geolocation"
import { useInspectionDraft } from "./_hooks/use-inspection-draft"
import { useInspectionSaveChannel } from "./_hooks/use-inspection-save-channel"

export type { RunDocumentInfo } from "./_components/types"

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

  /* Los tres hilos de la captura, cada uno con un solo dueño:
   *   - `draft`: lo que la persona ve y teclea, y su espejo en el dispositivo;
   *   - `channel`: lo único que habla con el servidor (autoguardado, «Guardar»,
   *     fotos, cierre y cierre guardado sin conexión);
   *   - `geo`: la ubicación, que alimenta al borrador.
   * El detalle sólo los conecta, deriva lo que las vistas necesitan y se lo
   * entrega como un `RunViewModel` a `RunCaptureView` o a `RunReadView`. */
  const inspectionDraft = useInspectionDraft({
    run, answers, closingAct, participants, currentUserId, canExecute,
    statusLabel: inspectionTaskStatusLabel(run.status),
  })
  const channel = useInspectionSaveChannel({
    run, items, answers, draft: inspectionDraft, closingAct, currentUserId, editable, canExecute,
  })
  const geo = useGeolocation(inspectionDraft.changeCoords)
  const { drafts, closing, coords } = inspectionDraft

  // Las acciones del registro (Acta PDF, Reabrir, Cancelar) viven en el encabezado
  // de la página, fuera de este árbol: la versión vigente del canal les llega por
  // aquí, no por las props, que van un paso atrás mientras un guardado está en vuelo.
  React.useEffect(() => {
    publishRunVersion(run.id, channel.version)
  }, [run.id, channel.version])

  // Lo que se evalúa para el cierre y el avance: las respuestas ya normalizadas
  // (recortadas), las mismas que el servidor va a ver.
  const currentAnswers = React.useMemo(
    () => items.flatMap((item) => {
      const current = drafts[draftKey(item.sectionId, item.itemId)]
      const normalized = current ? normalizeAnswer(item, current) : null
      return normalized ? [normalized] : []
    }),
    [items, drafts],
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
  // L4: la misma regla decide la etiqueta «Obligatorio / Opcional» de cada
  // ítem. Con `item.required` a secas, las 24 tarjetas de EPP decían «Opcional»
  // mientras el contador decía «2 de 24 obligatorios» y el cierre las exigía.
  const requiredKeys = React.useMemo(
    () => new Set(requiredItems.map((item) => draftKey(item.sectionId, item.itemId))),
    [requiredItems],
  )
  const answeredRequired = React.useMemo(() => requiredItems.filter((item) => drafts[draftKey(item.sectionId, item.itemId)]?.result).length, [requiredItems, drafts])

  /* P2-1: lo que todavía no se guarda y lo que falta para declarar ejecutada son
   * dos cosas distintas, y antes iban mezcladas en un solo muro rojo que decía
   * «Corrige antes de guardar». Guardar no se detiene por una fila mala (sólo se
   * retiene esa fila); lo que se bloquea es el cierre. */
  const completionSummary = React.useMemo(
    () => summarizeCompletion(completion.blockers, channel.held),
    [completion.blockers, channel.held],
  )
  const pendingLines = React.useMemo(() => completionSummary.lines.filter((line) => !line.held), [completionSummary])
  const heldByKey = React.useMemo(() => new Map(channel.held.map((row) => [row.key, row])), [channel.held])

  const rejection = channel.captureState.kind === "rejected" && !channel.queue.entry ? channel.captureState.message : null

  // #47: la misma regla que aplica el servidor. Con `declared_in_form` quien
  // transcribió no es el ejecutante de registro y sí puede revisar.
  const isExecutor = reviewerIsExecutorOfRecord({
    executedByUserId: run.executedByUserId,
    reviewerUserId: currentUserId,
    executorOfRecord: run.executorOfRecord,
  })
  const canCurrentUserReview = run.status === "completed" && canReview && !isExecutor
  // I-08: el bloqueo cubría sólo la auto-revisión. Quien ejecutó SIN permiso
  // de revisión (p. ej. el jefe de terreno) tampoco puede cerrarla y antes no
  // veía ningún mensaje — sólo cambia el copy según tenga o no el permiso.
  const reviewBlocked = run.status === "completed" && isExecutor
  const selfReviewBlocked = reviewBlocked && canReview
  const showMobileActionBar = editable || canCurrentUserReview
  // Los hallazgos existen una vez declarada ejecutada: ya no hay nada que editar.
  const showFindings = run.status === "completed" || run.status === "reviewed"

  const model: RunViewModel = {
    run, templateKind, worksiteName, assigneeName, executorName, reviewerName,
    sections, items, answers, findings, documents, closingAct,
    recordsDeviations, recordsPreventiveActions, deviationCatalog, isUnplannedInspection,
    participants, currentUserId, assignees, reviewers,
    pdtpActivityNumbers, pdtpReviewActivityNumbers, physicalSourceRequired,
    canExecute, canReview, canManage, canRequestRecharge, canStopVehicle, canIngest,
    editable, canCurrentUserReview, reviewBlocked, selfReviewBlocked, showMobileActionBar, showFindings,
    inspectionDraft, drafts, closing, coords, channel, geo,
    completion, summary, answeredCount, requiredItems, requiredKeys, answeredRequired,
    pendingLines, heldByKey, rejection,
    jumpToItem,
  }

  return (
    <div className={showMobileActionBar ? "space-y-6 pb-32 md:pb-0" : "space-y-6"}>
      {editable ? <RunCaptureView model={model} /> : <RunReadView model={model} />}
    </div>
  )
}
