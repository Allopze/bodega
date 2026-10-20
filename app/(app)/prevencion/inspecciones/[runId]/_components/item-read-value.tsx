"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import {
  fieldKindIsScorable,
  inspectionResultLabel,
  resultBadgeVariant,
} from "@/lib/prevention/inspections"
import { formatInspectionAnswerValue } from "@/lib/prevention/inspection-answer-format"
import { AnswerEvidence } from "./inspection-evidence"
import type { ReadBlock, ReadEntry } from "./read-view-helpers"
import { matrixColumnShortLabel } from "./run-view-helpers"

/** El resultado como la persona lo lee: la etiqueta del instrumento («Bueno», «Cumple»), con su color. */
function ResultBadge({ entry }: { entry: ReadEntry }) {
  const { item, draft } = entry
  if (draft.result === "") return <span className="text-xs text-[var(--color-text-subtle)]">Sin responder</span>
  return <MetaBadge meta={{ label: inspectionResultLabel(item.kind, draft.result), variant: resultBadgeVariant(draft.result) }} />
}

/** Las fotos de un ítem, sólo si las tiene: en lectura no hay columna ni control vacío. */
function ReadEvidence({ entry }: { entry: ReadEntry }) {
  if (entry.evidence.length === 0) return null
  return (
    <div className="mt-2">
      <AnswerEvidence
        answerId={entry.answerId}
        evidence={entry.evidence}
        editable={false}
        readyToPersist={false}
        itemLabel={entry.item.label}
      />
    </div>
  )
}

function UnconfirmedBadge({ entry }: { entry: ReadEntry }) {
  if (!entry.draft.needsConfirmation) return null
  return <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
}

/**
 * Un ítem suelto en modo lectura. Los que puntúan dicen su resultado y el
 * comentario; los que no (un N° de serie, una fecha, un relato) dicen lo que se
 * respondió, con la etiqueta de la opción y no el valor almacenado.
 */
function ReadItem({ entry }: { entry: ReadEntry }) {
  const { item, draft } = entry
  if (!fieldKindIsScorable(item.kind)) {
    return (
      <div className="md:grid md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-x-4">
        <p className="text-xs text-[var(--color-text-subtle)] md:pt-0.5">{item.label}</p>
        <div className="min-w-0">
          <p className="whitespace-pre-wrap break-words text-sm font-medium">{formatInspectionAnswerValue(item, draft.value, "Sin respuesta")}</p>
          <UnconfirmedBadge entry={entry} />
          <ReadEvidence entry={entry} />
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 break-words text-sm">{item.label}</p>
        <div className="flex shrink-0 items-center gap-2">
          <UnconfirmedBadge entry={entry} />
          <ResultBadge entry={entry} />
        </div>
      </div>
      {draft.comment.trim() !== "" && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-text-muted)]">{draft.comment}</p>
      )}
      <ReadEvidence entry={entry} />
    </div>
  )
}

/** Una prenda de la matriz: su nombre y, debajo, cada celda («Usa · Sí», «Estado · Malo»). */
function ReadMatrixRow({ rowLabel, entries }: { rowLabel: string; entries: ReadEntry[] }) {
  return (
    <div>
      <p className="text-sm font-medium">{rowLabel}</p>
      <ul className="mt-1 space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.key} id={`item-${entry.key}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-[var(--color-text-subtle)]">{matrixColumnShortLabel(entry.item.matrix?.columnLabel ?? entry.item.label)}</span>
              <UnconfirmedBadge entry={entry} />
              <ResultBadge entry={entry} />
            </div>
            {entry.draft.comment.trim() !== "" && (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[var(--color-text-muted)]">{entry.draft.comment}</p>
            )}
            <ReadEvidence entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Una fila de la lista de una sección. El `id` es al que salta `jumpToItem`. */
export function ReadBlockRow({ block }: { block: ReadBlock }) {
  if (block.kind === "matrix") {
    return (
      <li className="scroll-mt-20 py-3">
        <ReadMatrixRow rowLabel={block.rowLabel} entries={block.entries} />
      </li>
    )
  }
  return (
    <li id={`item-${block.entry.key}`} className="scroll-mt-20 py-3">
      <ReadItem entry={block.entry} />
    </li>
  )
}
