"use client"

import * as React from "react"
import { ItemCapture } from "./item-capture"
import type { UpdateItemDraft } from "./item-answer-control"
import { MatrixRowCapture, type MatrixCellState } from "./matrix-row-capture"
import { draftKey, EMPTY_DRAFT, groupSectionItems, type SectionProgress } from "./run-view-helpers"
import type { RunViewModel } from "./run-view-types"
import type { ItemInfo, SectionInfo } from "./types"

export type SectionBlockModel = Pick<RunViewModel, "drafts" | "requiredKeys" | "heldByKey" | "channel">

/** Los manejadores que el ítem usa: estables, para que su `React.memo` corte el repintado. */
export interface CaptureHandlers {
  onUpdate: UpdateItemDraft
  onConfirmRead: (sectionId: string, itemId: string) => void
  ensureAnswerId: (key: string) => Promise<string>
  onEvidenceChange: (key: string, count: number) => void
}

/**
 * Una sección de la captura: su título con el lugar que ocupa en la secuencia y
 * cuánto lleva («Sección 2 de 5 · 3 de 12»; la secuencia sí lleva información:
 * dice dónde estás en el recorrido) y la lista de ítems separada por filetes,
 * sin una tarjeta por ítem. Las prendas de una matriz van juntas.
 */
export function SectionBlock({ section, sectionIndex, sectionCount, progress, model, handlers }: {
  section: SectionInfo
  sectionIndex: number
  sectionCount: number
  progress: SectionProgress
  model: SectionBlockModel
  handlers: CaptureHandlers
}) {
  const { drafts, requiredKeys, heldByKey, channel } = model
  const blocks = React.useMemo(() => groupSectionItems(section.items), [section.items])

  function cellOf(item: ItemInfo): MatrixCellState {
    const key = draftKey(section.id, item.id)
    const draft = drafts[key] ?? EMPTY_DRAFT
    const held = heldByKey.get(key)
    return {
      item,
      required: requiredKeys.has(key),
      result: draft.result,
      comment: draft.comment,
      value: draft.value,
      needsConfirmation: draft.needsConfirmation,
      answerId: channel.answerIds[key] ?? null,
      evidence: channel.evidenceByKey.get(key),
      heldReason: held?.reason ?? null,
      heldProblem: held?.problem ?? null,
    }
  }

  return (
    <section id={`section-${section.id}`} aria-labelledby={`section-title-${section.id}`} className="scroll-mt-20">
      {sectionCount > 1 && (
        <p className="text-eyebrow tabular-nums">Sección {sectionIndex + 1} de {sectionCount} · {progress.answered} de {progress.total}</p>
      )}
      <h2 id={`section-title-${section.id}`} className="text-h2">{section.title}</h2>
      <ul className="mt-2 divide-y divide-[var(--color-border)]">
        {blocks.map((block, blockIndex) => {
          if (block.kind === "matrix") {
            return (
              <MatrixRowCapture
                key={`matrix-${block.rowId}`}
                sectionId={section.id}
                index={blockIndex + 1}
                rowLabel={block.rowLabel}
                cells={block.items.map(cellOf)}
                {...handlers}
              />
            )
          }
          const cell = cellOf(block.item)
          return (
            <ItemCapture
              key={block.item.id}
              item={block.item}
              sectionId={section.id}
              index={blockIndex + 1}
              required={cell.required}
              result={cell.result}
              comment={cell.comment}
              value={cell.value}
              needsConfirmation={cell.needsConfirmation}
              answerId={cell.answerId}
              evidence={cell.evidence}
              heldReason={cell.heldReason}
              heldProblem={cell.heldProblem}
              {...handlers}
            />
          )
        })}
      </ul>
    </section>
  )
}
