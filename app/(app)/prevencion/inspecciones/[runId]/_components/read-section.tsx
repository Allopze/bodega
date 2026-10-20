"use client"

import * as React from "react"
import { CaretRight } from "@phosphor-icons/react"
import { ReadBlockRow } from "./item-read-value"
import { buildReadSection, foldedSectionLabel } from "./read-view-helpers"
import type { RunViewModel } from "./run-view-types"
import type { SectionInfo } from "./types"

export type ReadSectionModel = Pick<RunViewModel, "drafts" | "channel">

/**
 * Una sección en modo lectura: lo que pide atención va a la vista —lo que no
 * cumple, lo que quedó a medias, los datos registrados, lo que trae foto— y lo
 * conforme se pliega en «{Sección} · 12 conformes». Un solo árbol: ya no se pinta
 * una tarjeta para el teléfono y una tabla para el escritorio, así que ninguna
 * columna «Evidencia» queda vacía ni se repite el ítem.
 */
export function ReadSection({ section, model }: { section: SectionInfo; model: ReadSectionModel }) {
  const { drafts, channel } = model
  const view = React.useMemo(
    () => buildReadSection(section, drafts, (key) => channel.evidenceByKey.get(key), (key) => channel.answerIds[key]),
    [section, drafts, channel.evidenceByKey, channel.answerIds],
  )
  if (view.attention.length === 0 && view.foldedCount === 0) return null

  return (
    // `id`: los chips de sección y el «Ver…» de los avisos saltan aquí.
    <section id={`section-${section.id}`} aria-label={section.title} className="scroll-mt-20">
      {view.attention.length > 0 && (
        <>
          <h2 className="text-h2">{section.title}</h2>
          <ul className="mt-1 divide-y divide-[var(--color-border)]">
            {view.attention.map((block) => (
              <ReadBlockRow key={block.kind === "item" ? block.entry.key : `matrix-${block.rowId}`} block={block} />
            ))}
          </ul>
        </>
      )}
      {view.foldedCount > 0 && (
        <details className={view.attention.length > 0 ? "group mt-2 border-t border-[var(--color-border)]" : "group"}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium md:min-h-9 [&::-webkit-details-marker]:hidden">
            <CaretRight aria-hidden="true" weight="bold" className="size-3.5 shrink-0 text-[var(--color-text-subtle)] transition-transform group-open:rotate-90" />
            {foldedSectionLabel(section.title, view.counts)}
          </summary>
          <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {view.folded.map((block) => (
              <ReadBlockRow key={block.kind === "item" ? block.entry.key : `matrix-${block.rowId}`} block={block} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
