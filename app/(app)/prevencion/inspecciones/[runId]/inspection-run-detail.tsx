"use client"

import * as React from "react"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assessRunCompletion,
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
  reviewerIsExecutorOfRecord,
  runStatusBadgeVariant,
  summarizeCompliance,
  type ClosingActSpec,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  cancelInspectionRunAction,
  closeInspectionFindingAction,
  reopenInspectionRunAction,
} from "../actions"
import { Field } from "@/components/ui/field"
import { normalizeAnswer, summarizeCompletion } from "@/lib/prevention/inspection-capture"
import { clearInspectionDraftsOfRun } from "@/lib/prevention/inspection-draft-storage"
import {
  formatComplianceBasisPoints,
  formatInspectionAnswerValue,
  formatInspectionSubject,
} from "@/lib/prevention/inspection-answer-format"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import type {
  RunInfo,
  SectionInfo,
  AnswerInfo,
  FindingInfo,
  ResultValue,
  Draft,
  RunDocumentInfo,
} from "./_components/types"
import { RemindReviewButton, ReasonDialog, NonScorableField } from "./_components/run-detail-controls"
import { AnswerEvidence } from "./_components/inspection-evidence"
import { PreventiveActionsPanel, ParticipantsPanel, DeviationsPanel } from "./_components/deviation-panels"
import { CompleteDialog } from "./_components/complete-dialog"
import { CapaDialog, StopVehicleDialog } from "./_components/finding-dialogs"
import { SourceFormViewer, SourceFormUpload } from "./_components/source-form"
import { ReviewDialog } from "./_components/review-dialog"
import { OfflineClosePanel, RunCaptureMessages, RunSaveStatus } from "./_components/run-status"
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
   * El detalle sólo los conecta y los pinta. */
  const inspectionDraft = useInspectionDraft({
    run, answers, closingAct, participants, currentUserId, canExecute,
    statusLabel: inspectionTaskStatusLabel(run.status),
  })
  const channel = useInspectionSaveChannel({
    run, items, answers, draft: inspectionDraft, closingAct, currentUserId, editable, canExecute,
  })
  const geo = useGeolocation(inspectionDraft.changeCoords)
  const { drafts, closing, coords } = inspectionDraft
  const version = channel.version

  const emptyDraft: Draft = { result: "" as ResultValue, comment: "", value: "", needsConfirmation: false }

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

  const facts = [
    { label: "Estado", value: inspectionTaskStatusLabel(run.status) },
    { label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
    { label: "Faena", value: worksiteName },
    { label: "Sujeto", value: formatInspectionSubject(run.subjectType, run.subjectLabel) },
    { label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { label: "Programada para", value: run.scheduledFor ? formatDate(run.scheduledFor) : "Sin fecha" },
    { label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
    {
      label: "Resultado oficial",
      value: formatComplianceBasisPoints(run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints, "Sin fórmula en el documento"),
    },
    {
      label: "Resultado normalizado",
      value: formatComplianceBasisPoints(run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints, "Aún no calculable"),
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

  /** Los dos árboles (escritorio y teléfono) montan el mismo diálogo de cierre. */
  const completeDialog = (
    <CompleteDialog
      run={run}
      completion={completion}
      held={channel.held}
      online={channel.online}
      saving={channel.saving}
      disabled={channel.locked}
      onComplete={channel.complete}
      onQueueClose={channel.queueClose}
      onJump={jumpToItem}
    />
  )

  /** Evidencia fotográfica de un ítem: la misma en la tarjeta y en la fila. */
  function renderEvidence(key: string, item: SectionInfo["items"][number], current: Draft) {
    const heldRow = heldByKey.get(key)
    return (
      <AnswerEvidence
        answerId={channel.answerIds[key] ?? null}
        evidence={channel.evidenceByKey.get(key)}
        editable={editable}
        readyToPersist={current.result !== ""}
        ensureAnswerId={() => channel.ensureAnswerId(key)}
        itemLabel={item.label}
        onEvidenceChange={(count) => channel.onEvidenceChange(key, count)}
        blockedReason={heldRow?.reason === "invalid" ? "Completa el motivo antes de adjuntar fotos" : undefined}
      />
    )
  }

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
                  <TableCell><MetaBadge meta={{ label: `${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}`, variant: criticalityBadgeVariant(finding.criticality) }} /></TableCell>
                  <TableCell className="text-sm">
                    {FINDING_STATUS_LABELS[finding.status] ?? finding.status}
                    {finding.capaActionId && (
                      <Link href={`/prevencion/capa/${finding.capaActionId}`} className="ml-2 text-xs underline">Ver CAPA</Link>
                    )}
                  </TableCell>
                  {(canExecute || canReview) && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* #20: el servidor no deriva desde un run ya revisado; reabrirlo es el camino. */}
                        {canExecute && run.status === "completed" && finding.status === "open" && <CapaDialog finding={finding} assignees={assignees} hasVehicle={!!run.subjectVehicleId} />}
                        {canStopVehicle && run.subjectVehicleId && ["high", "critical"].includes(finding.criticality) && (
                          <StopVehicleDialog finding={finding} subjectLabel={run.subjectLabel} />
                        )}
                        {/* B-06: cierre manual sólo para hallazgos sin CAPA.
                            Los que la tienen se cierran al verificar o
                            cerrar su acción, en la misma transacción. */}
                        {canReview && finding.status === "open" && !finding.capaActionId && (
                          <ReasonDialog
                            trigger="Cerrar hallazgo"
                            title="Cerrar hallazgo"
                            description={finding.description}
                            action={(reason) => closeInspectionFindingAction({ findingId: finding.id, reason })}
                            confirmVariant="default"
                            successMessage="Hallazgo cerrado."
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
    <div className={showMobileActionBar ? "space-y-6 pb-32 md:pb-0" : "space-y-6"}>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Trabajo actual</p>
            <p className="mt-1 text-base font-semibold">{worksiteName}{run.subjectLabel ? ` · ${run.subjectLabel}` : ""}</p>
          </div>
          <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
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
          <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
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
              disabled={channel.locked || geo.state === "pending"}
              onClick={geo.capture}
            >
              {coords ? `Ubicación ${coords.lat}, ${coords.lon}` : geo.state === "pending" ? "Ubicando…" : "Capturar ubicación"}
            </Button>
          )}
          {editable && (
            <>
              {/* «Guardar» nunca se deshabilita por filas con problemas: guarda lo
                  que sí se puede y deja retenidas las demás (P1-1). */}
              <Button className="hidden md:inline-flex" type="button" size="sm" variant="secondary" disabled={channel.saving || channel.locked} onClick={() => void channel.save()}>
                {channel.saving ? "Guardando…" : "Guardar respuestas"}
              </Button>
              {/* INS-02: el autoguardado necesita decir en qué estado está, o
                  quien ejecuta no sabe si puede irse de la pantalla. La barra
                  del teléfono pinta este mismo estado (P1-7). */}
              <RunSaveStatus state={channel.captureState} className="hidden self-center md:inline" />
            </>
          )}
          {/* Función #3: el acta de LA inspección. El export Excel es agregado
              y en fiscalización se pide esta. */}
          {["completed", "reviewed"].includes(run.status) && (
            <Button asChild size="sm" variant="secondary">
              <a href={`/prevencion/inspecciones/${run.id}/print`} target="_blank" rel="noreferrer">Acta PDF</a>
            </Button>
          )}
          {editable && <span className="hidden md:inline-flex">{completeDialog}</span>}
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
              onDone={channel.applyVersion}
              confirmVariant="warning"
              reasonLabel="Motivo de la rectificación"
              successMessage="Inspección reabierta."
            />
          )}
          {/* A-04: cancelar una planificada que ya no corresponde. */}
          {canManage && ["planned", "in_progress", "completed"].includes(run.status) && (
            <ReasonDialog
              trigger="Cancelar inspección"
              title={`Cancelar ${run.code}`}
              description="La inspección deja de estar pendiente y sale de la bandeja. No se puede deshacer."
              action={(reason) => cancelInspectionRunAction({ runId: run.id, expectedVersion: version, reason })}
              onDone={(result) => {
                channel.applyVersion(result)
                // Cancelada: lo que quedó sin enviar en el dispositivo ya no aplica, en ninguna pestaña.
                clearInspectionDraftsOfRun(run.id)
              }}
              variant="ghost-danger"
              reasonLabel="Motivo de la cancelación"
              successMessage="Inspección cancelada."
            />
          )}
        </div>
      </div>

      {/* P1-8: los avisos de guardado ya no se pintan de verde ni prometen lo que
          no es cierto. Cada uno dice qué pasó, y el que exige acción trae sus botones. */}
      {canExecute && (
        <RunCaptureMessages
          state={channel.captureState}
          rejection={rejection}
          mirrorFailed={channel.mirrorFailed}
          restoreNotice={inspectionDraft.restoreNotice}
          pendingRestore={inspectionDraft.pendingRestore}
          resyncing={channel.resyncing}
          onRecover={channel.recoverConflict}
          onDiscard={channel.discardConflict}
          onViewCurrent={channel.viewCurrent}
          onRetry={() => void channel.retry()}
          onRecoverPending={inspectionDraft.recoverPending}
          onDiscardPending={inspectionDraft.discardPending}
        />
      )}

      {canExecute && channel.queue.entry && (
        <OfflineClosePanel
          entry={channel.queue.entry}
          sending={channel.queue.sending}
          online={channel.online}
          onSendNow={() => void channel.queue.sendNow()}
          onKeepEditing={() => void channel.queue.discard()}
          onRecover={() => void channel.queue.recover()}
          onDiscard={() => void channel.queue.discard()}
        />
      )}

      {reviewBlocked && (
        <div className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
          <p>
            {selfReviewBlocked
              ? "Tú ejecutaste esta inspección: debe revisarla y cerrarla otra persona con permiso de revisión."
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

      {editable && geo.state === "denied" && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          No se pudo obtener la ubicación. La inspección se registra igual.
        </p>
      )}

      {/* Lo que el servidor todavía no tiene. Aparte de lo que impide cerrar:
          guardar sigue funcionando, sólo estas filas quedan en el dispositivo. */}
      {editable && channel.held.length > 0 && (
        <Callout tone="warning" role="status" title="Respuestas que todavía no se guardan">
          <p>Las demás sí se guardan; estas quedan en este dispositivo hasta que las completes.</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {channel.held.map((row) => (
              <li key={row.key}>
                <button type="button" className="min-h-11 text-left underline md:min-h-0" onClick={() => jumpToItem(row.key)}>{row.problem}</button>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {editable && pendingLines.length > 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Para declarar ejecutada falta:</p>
          {/* I-06: lista completa con scroll interno, no un "y N más…" mudo. */}
          <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-4">
            {pendingLines.map((line) => (
              <li key={`${line.key ?? "acta"}:${line.text}`}>
                {line.key
                  ? <button type="button" className="min-h-11 text-left underline md:min-h-0" onClick={() => jumpToItem(line.key!)}>{line.text}</button>
                  : line.text}
              </li>
            ))}
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

      {/* Con un cierre guardado en el dispositivo la edición queda bloqueada: lo
          guardado es una foto del trabajo, y editar encima la dejaría desfasada.
          Un `fieldset` deshabilitado apaga de una vez todos los controles. */}
      <fieldset disabled={channel.locked} className="m-0 min-w-0 space-y-6 border-0 p-0">
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
                  const draft = drafts[key] ?? emptyDraft
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
                        {requiredKeys.has(key) ? <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} /> : <span className="text-xs text-[var(--color-text-subtle)]">Opcional</span>}
                      </div>
                      {draft.needsConfirmation && (
                        <div className="flex flex-wrap items-center gap-2">
                          <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
                          {editable && <Button type="button" size="sm" variant="secondary" onClick={() => inspectionDraft.confirmRead(section.id, item.id)}>Confirmar contra la foto</Button>}
                        </div>
                      )}
                      {scorable ? (
                        <>
                          <Field label="Resultado" required={requiredKeys.has(key)}>
                            {editable ? (
                              <Select value={draft.result || "__unset__"} onValueChange={(value) => inspectionDraft.update(section.id, item.id, { result: (value === "__unset__" ? "" : value) as ResultValue })}>
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
                            ) : draft.result ? <MetaBadge meta={{ label: `${inspectionResultLabel(item.kind, draft.result)}`, variant: resultBadgeVariant(draft.result) }} /> : <span>Sin respuesta</span>}
                          </Field>
                          <Field label="Comentario" hint={needsComment ? `Obligatorio para "${inspectionResultLabel(item.kind, draft.result)}"; mínimo 3 caracteres.` : "Opcional, salvo que el resultado requiera justificación."}>
                            {editable ? <Textarea value={draft.comment} onChange={(event) => inspectionDraft.update(section.id, item.id, { comment: event.target.value })} rows={3} aria-label={`Comentario de ${item.label}`} /> : <p className="text-sm">{draft.comment || "Sin comentario"}</p>}
                          </Field>
                        </>
                      ) : (
                        <Field label="Respuesta" required={requiredKeys.has(key)}>
                          {editable ? <NonScorableField item={item} value={draft.value} onChange={(next) => inspectionDraft.update(section.id, item.id, { value: next, result: next.trim() ? "recorded" : "" })} />
                            // I-17 / P2-2: en lectura la respuesta se dice como la persona la entiende
                            // (la fecha formateada, la opción por su etiqueta), no como se almacena.
                            : <p className="whitespace-pre-wrap text-sm">{formatInspectionAnswerValue(item, draft.value, "Sin respuesta")}</p>}
                        </Field>
                      )}
                      <Field label="Evidencia fotográfica" hint="La foto queda vinculada a este ítem.">
                        {renderEvidence(key, item, draft)}
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
                      const draft = drafts[key] ?? emptyDraft
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
                            {requiredKeys.has(key) && <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} className="ml-2" />}
                            {draft.needsConfirmation && (
                              <span className="mt-1 flex flex-wrap items-center gap-2">
                                <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
                                {editable && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => inspectionDraft.confirmRead(section.id, item.id)}
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
                                  <Select value={draft.result || "__unset__"} onValueChange={(v) => inspectionDraft.update(section.id, item.id, { result: (v === "__unset__" ? "" : v) as ResultValue })}>
                                    <SelectTrigger aria-label={`Resultado de ${item.label}`}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__unset__">Sin responder</SelectItem>
                                      {inspectionResultOptionsFor(item.kind).map((option) => (
                                        <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : draft.result ? (
                                  <MetaBadge meta={{ label: `${inspectionResultLabel(item.kind, draft.result)}`, variant: resultBadgeVariant(draft.result) }} />
                                ) : "—"}
                              </TableCell>
                              <TableCell>
                                {editable ? (
                                  <Input
                                    value={draft.comment}
                                    onChange={(event) => inspectionDraft.update(section.id, item.id, { comment: event.target.value })}
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
                                  onChange={(next) => inspectionDraft.update(section.id, item.id, {
                                    value: next,
                                    // El estado acompaña al contenido: sin valor
                                    // el ítem vuelve a "sin responder" y el
                                    // guardado lo borra (B-02).
                                    result: next.trim() ? "recorded" : "",
                                  })}
                                />
                              ) : (
                                // I-17 / P2-2: mismo formato que el resto de la pantalla.
                                <span className="text-sm whitespace-pre-wrap">{formatInspectionAnswerValue(item, draft.value, "—")}</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            {renderEvidence(key, item, draft)}
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
            <ParticipantsPanel
              runId={run.id}
              participants={participants}
              editable={editable && canExecute}
              initialRows={inspectionDraft.participants.initialRows}
              onRowsChange={inspectionDraft.participants.onRowsChange}
            />
          )}
          <DeviationsPanel
            runId={run.id}
            editable={editable}
            canExecute={canExecute}
            catalog={deviationCatalog}
            registered={findings.filter((finding) => finding.origin === "deviation")}
            narrative={isUnplannedInspection}
            onVersion={channel.applyVersion}
          />
          </>
        )}
        {recordsPreventiveActions && (
          <PreventiveActionsPanel runId={run.id} actions={findings.filter((finding) => finding.origin === "deviation")} assignees={assignees} editable={editable && canExecute} onVersion={channel.applyVersion} />
        )}

        {!physicalSourceRequired && canIngest && editable && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}

        {closingAct && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{closingAct.title}</h2>
            {editable ? (
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
                <Field label="Resultado" required>
                  <Select value={closing.result || "__unset__"} onValueChange={(value) => inspectionDraft.updateClosing((c) => ({ ...c, result: value === "__unset__" ? "" : value }))}>
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
                      onChange={(event) => inspectionDraft.updateClosing((c) => ({ ...c, restrictions: event.target.value }))}
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
                          onChange={(event) => inspectionDraft.updateClosing((c) => ({
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
      </fieldset>

      {/* I-09: en modo edición se quedan al final; en revisión ya se movieron
          justo después de la barra de secciones. */}
      {!findingsFirst && findingsSection}

      {run.status === "reviewed" && run.reviewComment && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Revisada {formatDateTime(run.reviewedAt!)} por {reviewerName ?? "—"}: {run.reviewComment}
        </p>
      )}

      {showMobileActionBar && (
        <div role="group" aria-label="Acciones de la inspección en el teléfono" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)] md:hidden">
          {editable ? (
            <>
              {/* P1-7: el mismo estado que el escritorio, a la vista de quien trabaja de pie. */}
              <RunSaveStatus state={channel.captureState} className="col-span-2 text-center" />
              <Button type="button" variant="secondary" disabled={channel.saving || channel.locked} onClick={() => void channel.save()}>{channel.saving ? "Guardando…" : "Guardar"}</Button>
              {completeDialog}
            </>
          ) : canCurrentUserReview ? (
            <div className="col-span-2"><ReviewDialog run={run} findings={findings} currentUserId={currentUserId} version={version} assignees={assignees} canExecute={canExecute} /></div>
          ) : null}
        </div>
      )}
    </div>
  )
}
