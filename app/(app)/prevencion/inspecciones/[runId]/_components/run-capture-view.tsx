"use client"

import * as React from "react"
import { ClosingActForm } from "./closing-act-form"
import { CompleteDialog } from "./complete-dialog"
import { RunDeviationRecords } from "./deviation-records"
import { MobileActionBar } from "./mobile-action-bar"
import { RunBlockers } from "./run-blockers"
import { RunCaptureNotices } from "./run-capture-notices"
import { RunWorkHeader } from "./run-work-header"
import { SectionBlock, type CaptureHandlers } from "./section-block"
import { sectionProgressById } from "./run-view-helpers"
import type { RunSaveChannel, RunViewModel } from "./run-view-types"
import { SectionNav } from "./section-nav"
import { SourceFormUpload, SourceFormViewer } from "./source-form"

/**
 * El canal se reconstruye en cada render, y con él `ensureAnswerId`; un
 * callback nuevo en cada tecla rompería el `React.memo` de los ítems (hasta 75).
 * Estos dos leen siempre el canal vigente desde un ref que se actualiza tras
 * cada render, y su identidad no cambia nunca. Los otros dos callbacks del ítem
 * (`inspectionDraft.update` y `confirmRead`) ya son estables en el hook.
 */
function useStableCaptureCallbacks(channel: RunSaveChannel) {
  const channelRef = React.useRef(channel)
  React.useEffect(() => {
    channelRef.current = channel
  })
  const ensureAnswerId = React.useCallback((key: string) => channelRef.current.ensureAnswerId(key), [])
  const onEvidenceChange = React.useCallback((key: string, count: number) => channelRef.current.onEvidenceChange(key, count), [])
  return { ensureAnswerId, onEvidenceChange }
}

/**
 * La vista de la inspección mientras se puede editar (`model.editable`): la
 * cabecera de trabajo (dónde, cuánto lleva, qué falta), los avisos de guardado,
 * y el checklist con sus controles. No muestra hallazgos (todavía no se generan)
 * ni el bloqueo de revisión. Se monta desde `InspectionRunDetail`, que le entrega
 * el modelo ya derivado; la vista no abre hooks de captura propios.
 *
 * El diálogo de «Declarar ejecutada» se monta aquí UNA vez y lo abren dos
 * botones: el de la cabecera (escritorio) y el de la barra fija (teléfono).
 */
export function RunCaptureView({ model }: { model: RunViewModel }) {
  const {
    run, sections, documents, closingAct, closing, canIngest, physicalSourceRequired, channel, inspectionDraft, drafts, completion, jumpToItem,
  } = model
  const [completeOpen, setCompleteOpen] = React.useState(false)
  const openComplete = React.useCallback(() => setCompleteOpen(true), [])
  const stable = useStableCaptureCallbacks(channel)
  const handlers: CaptureHandlers = {
    onUpdate: inspectionDraft.update,
    onConfirmRead: inspectionDraft.confirmRead,
    ensureAnswerId: stable.ensureAnswerId,
    onEvidenceChange: stable.onEvidenceChange,
  }
  const progress = React.useMemo(() => sectionProgressById(sections, drafts), [sections, drafts])

  return (
    <>
      <RunWorkHeader model={model} onDeclare={openComplete} />
      <RunCaptureNotices model={model} />

      {physicalSourceRequired && (
        <section className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div>
            <p className="text-eyebrow">Paso 1 · documento fuente</p>
            <h2 className="mt-1 text-base font-semibold">Transcribir el Reporte de Equipos</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">El jefe de faena carga y transcribe el registro físico del operador/mecánico. Prevención revisa y cierra después; no corresponde que quien transcribe se auto-revise.</p>
          </div>
          {canIngest && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}
          {documents.length > 0 && <div className="lg:hidden"><SourceFormViewer documents={documents} /></div>}
        </section>
      )}

      <RunBlockers model={model} />

      <SectionNav sections={sections} progress={progress} />

      {/* Con un cierre guardado en el dispositivo la edición queda bloqueada: lo
          guardado es una foto del trabajo, y editar encima la dejaría desfasada.
          Un `fieldset` deshabilitado apaga de una vez todos los controles. */}
      <fieldset disabled={channel.locked} className="m-0 min-w-0 space-y-10 border-0 p-0">
        <div className={documents.length > 0
          ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start"
          : undefined}
        >
          <div className="space-y-10">
            {sections.map((section, sectionIndex) => (
              <SectionBlock
                key={section.id}
                section={section}
                sectionIndex={sectionIndex}
                sectionCount={sections.length}
                progress={progress[section.id]!}
                model={model}
                handlers={handlers}
              />
            ))}
          </div>
          {documents.length > 0 && (physicalSourceRequired
            ? <div className="hidden lg:block"><SourceFormViewer documents={documents} /></div>
            : <SourceFormViewer documents={documents} />)}
        </div>

        <RunDeviationRecords model={model} />

        {!physicalSourceRequired && canIngest && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}

        {closingAct && (
          <ClosingActForm closingAct={closingAct} closing={closing} updateClosing={inspectionDraft.updateClosing} />
        )}
      </fieldset>

      <MobileActionBar model={model} onDeclare={openComplete} />

      <CompleteDialog
        run={run}
        completion={completion}
        held={channel.held}
        online={channel.online}
        saving={channel.saving}
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        onComplete={channel.complete}
        onQueueClose={channel.queueClose}
        onJump={jumpToItem}
      />
    </>
  )
}
