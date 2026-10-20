"use client"

import * as React from "react"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClosingActForm } from "./closing-act-form"
import { RunDeviationRecords } from "./deviation-records"
import { ItemCard } from "./item-card"
import { ItemRow } from "./item-row"
import { MobileActionBar } from "./mobile-action-bar"
import { RunActionBar } from "./run-action-bar"
import { RunBlockers } from "./run-blockers"
import { RunCaptureNotices } from "./run-capture-notices"
import { RunFacts } from "./run-facts"
import type { RunViewModel } from "./run-view-types"
import { SectionNav } from "./section-nav"
import { SourceFormUpload, SourceFormViewer } from "./source-form"

/**
 * La vista de la inspección mientras se puede editar (`model.editable`): ficha y
 * acciones, avisos de guardado, lo que impide declararla ejecutada, y el
 * checklist con sus controles. No muestra hallazgos (todavía no se generan) ni
 * el bloqueo de revisión. Se monta desde `InspectionRunDetail`, que le entrega
 * el modelo ya derivado; la vista no abre hooks de captura propios.
 */
export function RunCaptureView({ model }: { model: RunViewModel }) {
  const {
    run, sections, documents, closingAct, closing, canIngest, physicalSourceRequired, channel, geo, inspectionDraft,
  } = model

  return (
    <>
      <RunFacts model={model} />
      <RunActionBar model={model} />
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

      {geo.state === "denied" && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          No se pudo obtener la ubicación. La inspección se registra igual.
        </p>
      )}

      <RunBlockers model={model} />

      <SectionNav sections={sections} />

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
                {section.items.map((item, itemIndex) => (
                  <ItemCard key={item.id} model={model} section={section} item={item} itemIndex={itemIndex} />
                ))}
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
                    {section.items.map((item) => (
                      <ItemRow key={item.id} model={model} section={section} item={item} />
                    ))}
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

        <RunDeviationRecords model={model} />

        {!physicalSourceRequired && canIngest && <SourceFormUpload runId={run.id} hasDocuments={documents.length > 0} />}

        {closingAct && (
          <ClosingActForm closingAct={closingAct} closing={closing} updateClosing={inspectionDraft.updateClosing} />
        )}
      </fieldset>

      <MobileActionBar model={model} />
    </>
  )
}
