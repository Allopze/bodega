"use client"

import * as React from "react"
import { ClosingActRead } from "./closing-act-read"
import { RunDeviationRecords } from "./deviation-records"
import { FindingsSection } from "./findings-section"
import { MobileActionBar } from "./mobile-action-bar"
import { hasAnyAnswer } from "./read-view-helpers"
import { ReadSection } from "./read-section"
import { assessReviewForRun, ReviewDialog, reviewActionLabel } from "./review-dialog"
import { ReviewBlockedNotice } from "./run-blockers"
import { RunCaptureNotices } from "./run-capture-notices"
import { RunReadSummary } from "./run-read-summary"
import type { RunViewModel } from "./run-view-types"
import { SectionNav } from "./section-nav"
import { SourceFormViewer } from "./source-form"

/**
 * La vista de la inspección cuando NO se edita (`!model.editable`): sin permiso
 * de ejecución, o ya declarada ejecutada, revisada o cancelada. Es la de lectura
 * y revisión, y se lee de arriba abajo en el orden en que se decide:
 *
 *   1. el resumen (resultado, conteos, hallazgos abiertos, acta y firmas, quién
 *      ejecutó y quién revisó), con el estado una sola vez;
 *   2. los hallazgos (I-09): en revisión el trabajo es juzgarlos, no recorrer el
 *      checklist para llegar a ellos;
 *   3. lo que no cumple, lo registrado y lo que trae foto, por sección, con lo
 *      conforme plegado en «{Sección} · 12 conformes»;
 *   4. lo que registran los instrumentos sin ítems puntuables, y el acta.
 *
 * «Revisar y cerrar» abre UN diálogo, montado aquí, desde el botón de la cabecera
 * (escritorio) y el de la barra fija (teléfono).
 */
export function RunReadView({ model }: { model: RunViewModel }) {
  const {
    run, sections, findings, documents, closingAct, physicalSourceRequired, reviewBlocked, showFindings, channel,
    drafts, canCurrentUserReview, currentUserId, assignees, canExecute,
  } = model
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const openReview = React.useCallback(() => setReviewOpen(true), [])
  const review = React.useMemo(
    () => assessReviewForRun({ run: { executedByUserId: run.executedByUserId, executorOfRecord: run.executorOfRecord }, findings, currentUserId }),
    [run.executedByUserId, run.executorOfRecord, findings, currentUserId],
  )
  const reviewLabel = reviewActionLabel(review)
  const answered = hasAnyAnswer(sections, drafts)
  const hasItems = sections.some((section) => section.items.length > 0)

  return (
    <>
      <RunReadSummary model={model} onReview={canCurrentUserReview ? openReview : undefined} reviewLabel={reviewLabel} />
      <RunCaptureNotices model={model} />

      {reviewBlocked && <ReviewBlockedNotice model={model} />}

      {physicalSourceRequired && documents.length > 0 && (
        <section aria-label="Documento fuente" className="space-y-3 lg:hidden">
          <SourceFormViewer documents={documents} />
        </section>
      )}

      {/* I-09: un índice de secciones sirve a cualquiera que lea el checklist, no
          sólo a quien ejecuta. Sin respuestas no hay secciones que indexar. */}
      {answered && <SectionNav sections={sections} findingsCount={showFindings ? findings.length : undefined} />}

      {showFindings && <FindingsSection model={model} />}

      {/* Un `fieldset` deshabilitado apaga de una vez todos los controles si hay
          un cierre guardado en el dispositivo. */}
      <fieldset disabled={channel.locked} className="m-0 min-w-0 space-y-8 border-0 p-0">
        <div className={documents.length > 0
          ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start"
          : undefined}
        >
          <div className="space-y-6">
            {answered
              ? sections.map((section) => <ReadSection key={section.id} section={section} model={model} />)
              : hasItems && run.status !== "cancelled" && <p className="text-sm text-[var(--color-text-subtle)]">Esta inspección no tiene respuestas registradas.</p>}
          </div>
          {documents.length > 0 && (physicalSourceRequired
            ? <div className="hidden lg:block"><SourceFormViewer documents={documents} /></div>
            : <SourceFormViewer documents={documents} />)}
        </div>

        <RunDeviationRecords model={model} />

        {closingAct && (run.status === "completed" || run.status === "reviewed") && <ClosingActRead closingAct={closingAct} run={run} />}
      </fieldset>

      <MobileActionBar model={model} onReview={canCurrentUserReview ? openReview : undefined} reviewLabel={reviewLabel} />

      {canCurrentUserReview && (
        <ReviewDialog
          run={run}
          findings={findings}
          currentUserId={currentUserId}
          version={channel.version}
          assignees={assignees}
          canExecute={canExecute}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
        />
      )}
    </>
  )
}
