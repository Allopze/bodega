"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ANSWER_COMMENT_MIN_LENGTH, fieldKindIsScorable } from "@/lib/prevention/inspections"
import type { HeldRow } from "@/lib/prevention/inspection-capture"
import { ItemAnswerControl, type UpdateItemDraft } from "./item-answer-control"
import {
  ItemNoteFields,
  NotesDisclosure,
  notesSummary,
  useNotesDisclosure,
  usePhotoCounts,
  type ItemEvidenceList,
} from "./item-notes"
import { draftKey, reasonIsMissing } from "./run-view-helpers"
import type { ItemInfo } from "./types"

/**
 * El texto de problema en línea de un ítem: lo que impide guardar esta respuesta.
 * Si falta el motivo se dice corto (el ítem ya está a la vista); cualquier otro
 * problema de una fila retenida va tal como lo dice el servidor.
 */
export function itemProblemText(args: {
  scorable: boolean
  result: string
  comment: string
  heldProblem: string | null
}): string | null {
  if (args.scorable && reasonIsMissing(args)) return `Falta el motivo: escribe al menos ${ANSWER_COMMENT_MIN_LENGTH} caracteres.`
  return args.heldProblem
}

export interface ItemCaptureProps {
  item: ItemInfo
  sectionId: string
  /** Su número dentro de la sección, tal como se lee en el papel. */
  index: number
  /** La misma regla que el cierre (`requiredKeys`): «Opcional» sólo si de verdad no se exige. */
  required: boolean
  /* Lo que el borrador dice de este ítem, ya como valores simples: el modelo se
   * reconstruye en cada render y pasarlo entero rompería el `React.memo`. */
  result: string
  comment: string
  value: string
  needsConfirmation: boolean
  answerId: string | null
  evidence: ItemEvidenceList | undefined
  heldReason: HeldRow["reason"] | null
  heldProblem: string | null
  /* Callbacks estables (ver `useStableCaptureCallbacks`). */
  onUpdate: UpdateItemDraft
  onConfirmRead: (sectionId: string, itemId: string) => void
  ensureAnswerId: (key: string) => Promise<string>
  onEvidenceChange: (key: string, count: number) => void
}

/**
 * Un ítem de la captura, en UN solo árbol (antes eran una tarjeta móvil y una
 * fila de tabla con los mismos controles, ocultas por CSS según el ancho): la
 * etiqueta, la respuesta a un toque de 44 px y, plegado, el comentario y las
 * fotos —que se abre solo cuando la respuesta exige motivo—.
 *
 * `React.memo`: una inspección llega a 75 ítems y cada tecla cambia el borrador.
 * Sin él, teclear en un comentario repintaría todos los demás.
 */
export const ItemCapture = React.memo(function ItemCapture({
  item, sectionId, index, required, result, comment, value, needsConfirmation, answerId, evidence, heldReason, heldProblem,
  onUpdate, onConfirmRead, ensureAnswerId, onEvidenceChange,
}: ItemCaptureProps) {
  const key = draftKey(sectionId, item.id)
  const scorable = fieldKindIsScorable(item.kind)
  const photos = usePhotoCounts()
  const serverPhotoCount = evidence?.length ?? 0
  const photoCount = photos.countOf(key, serverPhotoCount)
  const reasonMissing = scorable && reasonIsMissing({ result, comment })
  const problem = itemProblemText({ scorable, result, comment, heldProblem })
  const problemId = `item-problema-${React.useId()}`
  // Se abre solo cuando la respuesta exige motivo, o hay fotos que quitar para poder dejarla «Sin responder».
  const disclosure = useNotesDisclosure(reasonMissing || heldReason === "unanswer_with_photos")
  const answered = result !== ""

  return (
    <li id={`item-${key}`} className="scroll-mt-28 py-3">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-medium leading-snug">{index}. {item.label}</h3>
          {!required && <span className="shrink-0 text-xs text-[var(--color-text-subtle)]">Opcional</span>}
        </div>
        {needsConfirmation && (
          <div className="flex flex-wrap items-center gap-2">
            <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
            <Button type="button" size="sm" variant="secondary" onClick={() => onConfirmRead(sectionId, item.id)}>Confirmar contra la foto</Button>
          </div>
        )}
        <ItemAnswerControl
          item={item}
          sectionId={sectionId}
          result={result}
          value={value}
          required={required}
          describedBy={problem ? problemId : undefined}
          onUpdate={onUpdate}
        />
        {problem && <p id={problemId} className="text-xs text-[var(--color-danger-ink)]">{problem}</p>}
        <NotesDisclosure
          open={disclosure.open}
          onOpenChange={disclosure.setOpen}
          attention={reasonMissing}
          summary={notesSummary({ reasonMissing, hasComment: scorable && comment.trim().length > 0, photoCount, canComment: scorable })}
        >
          <ItemNoteFields
            item={item}
            sectionId={sectionId}
            comment={comment}
            answered={answered}
            answerId={answerId}
            evidence={evidence}
            heldReason={heldReason}
            onUpdate={onUpdate}
            ensureAnswerId={ensureAnswerId}
            onEvidenceChange={onEvidenceChange}
            onPhotoCount={(photoKey, count) => photos.record(photoKey, serverPhotoCount, count)}
          />
        </NotesDisclosure>
      </div>
    </li>
  )
})
