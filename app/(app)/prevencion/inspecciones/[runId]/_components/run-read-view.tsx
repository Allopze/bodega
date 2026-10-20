"use client"

import * as React from "react"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/utils"
import { ClosingActRead } from "./closing-act-read"
import { RunDeviationRecords } from "./deviation-records"
import { FindingsSection } from "./findings-section"
import { ItemCard } from "./item-card"
import { ItemRow } from "./item-row"
import { MobileActionBar } from "./mobile-action-bar"
import { RunActionBar } from "./run-action-bar"
import { ReviewBlockedNotice } from "./run-blockers"
import { RunCaptureNotices } from "./run-capture-notices"
import { RunFacts } from "./run-facts"
import type { RunViewModel } from "./run-view-types"
import { SectionNav } from "./section-nav"
import { SourceFormViewer } from "./source-form"

/**
 * La vista de la inspección cuando NO se edita (`!model.editable`): sin permiso
 * de ejecución, o ya declarada ejecutada, revisada o cancelada. Es la de lectura
 * y revisión: los hallazgos van primero (I-09; en revisión el trabajo es
 * juzgarlos, no recorrer el checklist para llegar a ellos), después las
 * secciones con lo que se respondió, el acta y la revisión.
 */
export function RunReadView({ model }: { model: RunViewModel }) {
  const {
    run, sections, findings, documents, closingAct, physicalSourceRequired, reviewBlocked, showFindings, channel, reviewerName,
  } = model

  return (
    <>
      <RunFacts model={model} />
      <RunActionBar model={model} />
      <RunCaptureNotices model={model} />

      {reviewBlocked && <ReviewBlockedNotice model={model} />}

      {physicalSourceRequired && (
        <section className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div>
            <p className="text-eyebrow">Paso 1 · documento fuente</p>
            <h2 className="mt-1 text-base font-semibold">Transcribir el Reporte de Equipos</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">El jefe de faena carga y transcribe el registro físico del operador/mecánico. Prevención revisa y cierra después; no corresponde que quien transcribe se auto-revise.</p>
          </div>
          {documents.length > 0 && <div className="lg:hidden"><SourceFormViewer documents={documents} /></div>}
        </section>
      )}

      {/* I-09: ya no depende de `editable` — un índice de secciones sirve a
          cualquiera que lea el checklist, no sólo a quien ejecuta. */}
      <SectionNav sections={sections} findingsCount={showFindings ? findings.length : undefined} />

      {/* I-09: en revisión los hallazgos se adelantan antes de las secciones. Es
          una regla de lectura (¿hay algo que revisar?), no de permiso: cualquiera
          que abre una inspección terminada los quiere primero. */}
      {showFindings && <FindingsSection model={model} />}

      {/* Un `fieldset` deshabilitado apaga de una vez todos los controles si hay
          un cierre guardado en el dispositivo. */}
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

        {closingAct && <ClosingActRead closingAct={closingAct} run={run} />}
      </fieldset>

      {run.status === "reviewed" && run.reviewComment && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Revisada {formatDateTime(run.reviewedAt!)} por {reviewerName ?? "—"}: {run.reviewComment}
        </p>
      )}

      <MobileActionBar model={model} />
    </>
  )
}
