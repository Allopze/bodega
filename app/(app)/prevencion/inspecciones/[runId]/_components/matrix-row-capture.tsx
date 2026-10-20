"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { fieldKindIsScorable } from "@/lib/prevention/inspections"
import type { HeldRow } from "@/lib/prevention/inspection-capture"
import { ItemAnswerControl, type UpdateItemDraft } from "./item-answer-control"
import { itemProblemText } from "./item-capture"
import {
  ItemNoteFields,
  NotesDisclosure,
  notesSummary,
  useNotesDisclosure,
  usePhotoCounts,
  type ItemEvidenceList,
} from "./item-notes"
import { draftKey, matrixColumnShortLabel, reasonIsMissing } from "./run-view-helpers"
import type { ItemInfo } from "./types"

/** Lo que el borrador y el servidor dicen de UNA celda de la prenda (usa, estado…). */
export interface MatrixCellState {
  item: ItemInfo
  required: boolean
  result: string
  comment: string
  value: string
  needsConfirmation: boolean
  answerId: string | null
  evidence: ItemEvidenceList | undefined
  heldReason: HeldRow["reason"] | null
  heldProblem: string | null
}

export interface MatrixRowCaptureProps {
  sectionId: string
  index: number
  rowLabel: string
  cells: MatrixCellState[]
  onUpdate: UpdateItemDraft
  onConfirmRead: (sectionId: string, itemId: string) => void
  ensureAnswerId: (key: string) => Promise<string>
  onEvidenceChange: (key: string, count: number) => void
}

function sameCell(a: MatrixCellState, b: MatrixCellState): boolean {
  return a.item === b.item && a.required === b.required && a.result === b.result && a.comment === b.comment
    && a.value === b.value && a.needsConfirmation === b.needsConfirmation && a.answerId === b.answerId
    && a.evidence === b.evidence && a.heldReason === b.heldReason && a.heldProblem === b.heldProblem
}

/**
 * Las celdas se arman en cada render del padre (arreglo y objetos nuevos), así
 * que se compara su contenido: sin esto el `memo` nunca cortaba el repintado.
 */
function sameRow(prev: MatrixRowCaptureProps, next: MatrixRowCaptureProps): boolean {
  return prev.sectionId === next.sectionId && prev.index === next.index && prev.rowLabel === next.rowLabel
    && prev.onUpdate === next.onUpdate && prev.onConfirmRead === next.onConfirmRead
    && prev.ensureAnswerId === next.ensureAnswerId && prev.onEvidenceChange === next.onEvidenceChange
    && prev.cells.length === next.cells.length && prev.cells.every((cell, i) => sameCell(cell, next.cells[i]!))
}

/**
 * Una prenda de la matriz (EPP): el Anexo es prenda × {Usa, Estado} y cada
 * dimensión se persiste por separado, pero para quien inspecciona es UNA prenda.
 * Una sola unidad con un grupo de respuesta por dimensión —lado a lado desde
 * `md`— y un solo pliegue de comentario y fotos con los campos de cada una.
 * Antes eran dos tarjetas por prenda, y la ficha de un trabajador medía 11.800 px.
 *
 * El nombre accesible de cada grupo sigue siendo «Resultado de {ítem}»
 * («Resultado de Casco: usa»): el rótulo visible («Usa») está contenido en él.
 */
export const MatrixRowCapture = React.memo(function MatrixRowCapture({
  sectionId, index, rowLabel, cells, onUpdate, onConfirmRead, ensureAnswerId, onEvidenceChange,
}: MatrixRowCaptureProps) {
  const photos = usePhotoCounts()
  const problemIdBase = React.useId()
  const reasonMissing = cells.some((cell) => fieldKindIsScorable(cell.item.kind) && reasonIsMissing(cell))
  const needsAttention = reasonMissing || cells.some((cell) => cell.heldReason === "unanswer_with_photos")
  const disclosure = useNotesDisclosure(needsAttention)
  const photoCount = cells.reduce(
    (sum, cell) => sum + photos.countOf(draftKey(sectionId, cell.item.id), cell.evidence?.length ?? 0),
    0,
  )
  const hasComment = cells.some((cell) => fieldKindIsScorable(cell.item.kind) && cell.comment.trim().length > 0)

  return (
    <li className="py-3">
      <div className="space-y-2">
        <h3 className="text-sm font-medium leading-snug">{index}. {rowLabel}</h3>
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          {cells.map((cell) => {
            const key = draftKey(sectionId, cell.item.id)
            const scorable = fieldKindIsScorable(cell.item.kind)
            const problem = itemProblemText({ scorable, result: cell.result, comment: cell.comment, heldProblem: cell.heldProblem })
            const problemId = `${problemIdBase}-${cell.item.id}`
            return (
              <div key={cell.item.id} id={`item-${key}`} className="scroll-mt-28 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">{matrixColumnShortLabel(cell.item.matrix?.columnLabel ?? cell.item.label)}</p>
                  {!cell.required && <span className="text-xs text-[var(--color-text-subtle)]">Opcional</span>}
                </div>
                {cell.needsConfirmation && (
                  <div className="flex flex-wrap items-center gap-2">
                    <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
                    <Button type="button" size="sm" variant="secondary" onClick={() => onConfirmRead(sectionId, cell.item.id)}>Confirmar contra la foto</Button>
                  </div>
                )}
                <ItemAnswerControl
                  item={cell.item}
                  sectionId={sectionId}
                  result={cell.result}
                  value={cell.value}
                  required={cell.required}
                  describedBy={problem ? problemId : undefined}
                  onUpdate={onUpdate}
                />
                {problem && <p id={problemId} className="text-xs text-[var(--color-danger-ink)]">{problem}</p>}
              </div>
            )
          })}
        </div>
        <NotesDisclosure
          open={disclosure.open}
          onOpenChange={disclosure.setOpen}
          attention={reasonMissing}
          summary={notesSummary({ reasonMissing, hasComment, photoCount, canComment: cells.some((cell) => fieldKindIsScorable(cell.item.kind)) })}
        >
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            {cells.map((cell) => (
              <ItemNoteFields
                key={cell.item.id}
                item={cell.item}
                sectionId={sectionId}
                label={matrixColumnShortLabel(cell.item.matrix?.columnLabel ?? cell.item.label)}
                comment={cell.comment}
                answered={cell.result !== ""}
                answerId={cell.answerId}
                evidence={cell.evidence}
                heldReason={cell.heldReason}
                onUpdate={onUpdate}
                ensureAnswerId={ensureAnswerId}
                onEvidenceChange={onEvidenceChange}
                onPhotoCount={(photoKey, count) => photos.record(photoKey, cell.evidence?.length ?? 0, count)}
              />
            ))}
          </div>
        </NotesDisclosure>
      </div>
    </li>
  )
}, sameRow)
