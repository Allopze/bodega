"use client"

import * as React from "react"
import { CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { fieldKindIsScorable } from "@/lib/prevention/inspections"
import type { HeldRow } from "@/lib/prevention/inspection-capture"
import { cn } from "@/lib/utils"
import { AnswerEvidence } from "./inspection-evidence"
import type { UpdateItemDraft } from "./item-answer-control"
import { draftKey } from "./run-view-helpers"
import type { AnswerInfo, ItemInfo } from "./types"

/** Las fotos que el servidor tiene de una respuesta. */
export type ItemEvidenceList = AnswerInfo["evidence"]

/**
 * Cuántas fotos tiene una respuesta ahora: las del servidor, hasta que
 * `AnswerEvidence` avise de una subida o de un borrado (`onEvidenceChange`). Si
 * el servidor devuelve otra cuenta (otra sesión, un refresco), manda el servidor.
 */
export function usePhotoCounts() {
  const [local, setLocal] = React.useState<Record<string, { server: number; count: number }>>({})
  const countOf = React.useCallback((key: string, serverCount: number) => {
    const entry = local[key]
    return entry && entry.server === serverCount ? entry.count : serverCount
  }, [local])
  const record = React.useCallback((key: string, serverCount: number, count: number) => {
    setLocal((current) => ({ ...current, [key]: { server: serverCount, count } }))
  }, [])
  return { countOf, record }
}

/**
 * El pliegue «comentario o foto» abierto por defecto sólo cuando hace falta:
 * cuando la respuesta exige motivo (o hay fotos que quitar), y SIN robar el
 * foco —quien está respondiendo ítem tras ítem no debe perder el lugar—. Pasa a
 * abierto en la transición (no en cada render), así que quien lo cierra a mano
 * no lo ve reabrirse mientras sigue escribiendo.
 */
export function useNotesDisclosure(needsAttention: boolean) {
  const [open, setOpen] = React.useState(needsAttention)
  const [previous, setPrevious] = React.useState(needsAttention)
  if (needsAttention !== previous) {
    setPrevious(needsAttention)
    if (needsAttention) setOpen(true)
  }
  return { open, setOpen }
}

/** Lo que dice el pliegue cerrado: qué falta, qué hay o qué se puede agregar. */
export function notesSummary(args: {
  reasonMissing: boolean
  hasComment: boolean
  photoCount: number
  /** Los ítems que no puntúan no llevan comentario: sólo fotos. */
  canComment: boolean
}): string {
  if (args.reasonMissing) return "Motivo obligatorio"
  const parts: string[] = []
  if (args.hasComment) parts.push("Comentario")
  if (args.photoCount > 0) parts.push(`${args.photoCount} ${args.photoCount === 1 ? "foto" : "fotos"}`)
  if (parts.length > 0) return parts.join(" · ")
  return args.canComment ? "Agregar comentario o foto" : "Agregar foto"
}

/** El pliegue: `<details>` nativo y controlado, con el resumen a 44 px en el teléfono. */
export function NotesDisclosure({ open, onOpenChange, summary, attention, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: string
  /** El resumen pide algo (falta el motivo): va en tinta de peligro, y el texto lo dice igual. */
  attention?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary
        className={cn(
          "flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium md:min-h-8 [&::-webkit-details-marker]:hidden",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          attention ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        )}
      >
        <CaretRight aria-hidden="true" weight="bold" className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {summary}
      </summary>
      <div className="space-y-3 pb-1 pt-1">{children}</div>
    </details>
  )
}

/**
 * Lo que va dentro del pliegue de UN ítem: el comentario (sólo si el ítem
 * puntúa), las fotos y «Quitar respuesta».
 */
export function ItemNoteFields({
  item, sectionId, label, comment, answered, answerId, evidence, heldReason, onUpdate, ensureAnswerId, onEvidenceChange, onPhotoCount,
}: {
  item: ItemInfo
  sectionId: string
  /** Rótulo corto sobre los campos cuando el pliegue sirve a varios ítems (prenda: «Usa» / «Estado»). */
  label?: string
  comment: string
  /** Tiene respuesta (`result` distinto de «Sin responder»): sin ella no hay nada que quitar ni foto que colgar. */
  answered: boolean
  answerId: string | null
  evidence: ItemEvidenceList | undefined
  heldReason: HeldRow["reason"] | null
  onUpdate: UpdateItemDraft
  ensureAnswerId: (key: string) => Promise<string>
  onEvidenceChange: (key: string, count: number) => void
  /** Avisa la cuenta de fotos tras subir o quitar una: el resumen del pliegue la muestra. */
  onPhotoCount: (key: string, count: number) => void
}) {
  const key = draftKey(sectionId, item.id)
  const scorable = fieldKindIsScorable(item.kind)
  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>}
      {scorable && (
        <Textarea
          value={comment}
          onChange={(event) => onUpdate(sectionId, item.id, { comment: event.target.value })}
          rows={2}
          aria-label={`Comentario de ${item.label}`}
          data-item-comment=""
          placeholder="Comentario"
          className="min-h-[3.75rem] py-2"
        />
      )}
      <AnswerEvidence
        answerId={answerId}
        evidence={evidence}
        editable
        readyToPersist={answered}
        ensureAnswerId={() => ensureAnswerId(key)}
        itemLabel={item.label}
        onEvidenceChange={(count) => {
          onPhotoCount(key, count)
          onEvidenceChange(key, count)
        }}
        blockedReason={heldReason === "invalid" ? "Completa el motivo antes de adjuntar fotos" : undefined}
      />
      {answered && (
        <Button
          type="button"
          size="sm"
          variant="ghost-danger"
          // Quita lo respondido y lo escrito: el ítem vuelve a «Sin responder». Si tiene fotos, el guardado las retiene y lo dice.
          onClick={() => onUpdate(sectionId, item.id, { result: "", comment: "", value: "" })}
        >
          Quitar respuesta
        </Button>
      )}
    </div>
  )
}
