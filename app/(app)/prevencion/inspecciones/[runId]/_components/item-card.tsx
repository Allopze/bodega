"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  fieldKindIsScorable,
  inspectionResultLabel,
  inspectionResultOptionsFor,
  resultBadgeVariant,
  resultSelectToneClass,
} from "@/lib/prevention/inspections"
import { formatInspectionAnswerValue } from "@/lib/prevention/inspection-answer-format"
import { ItemEvidence, type ItemEvidenceModel } from "./item-evidence"
import { NonScorableField } from "./run-detail-controls"
import { draftKey, EMPTY_DRAFT } from "./run-view-helpers"
import type { RunViewModel } from "./run-view-types"
import type { ResultValue, SectionInfo } from "./types"

export type ItemCardModel = ItemEvidenceModel & Pick<RunViewModel, "drafts" | "requiredKeys" | "inspectionDraft">

/**
 * La tarjeta de un ítem en el teléfono (`md:hidden`; el escritorio pinta
 * `ItemRow`). Edita cuando `editable` y si no, muestra la respuesta tal como la
 * persona la entiende. El `id` `item-mobile-…` es al que salta `jumpToItem`.
 */
export function ItemCard({ model, section, item, itemIndex }: {
  model: ItemCardModel
  section: SectionInfo
  item: SectionInfo["items"][number]
  itemIndex: number
}) {
  const { editable, drafts, requiredKeys, inspectionDraft } = model
  const key = draftKey(section.id, item.id)
  const draft = drafts[key] ?? EMPTY_DRAFT
  // I-05: "No cumple" exige motivo igual que "No aplica"/"Regular" — es
  // el resultado que genera el hallazgo.
  const needsComment = draft.result === "not_applicable" || draft.result === "partial" || draft.result === "non_conforming"
  const scorable = fieldKindIsScorable(item.kind)
  return (
    <article id={`item-mobile-${key}`} className="scroll-mt-28 space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug">
          {itemIndex + 1}. {item.matrix?.rowLabel ?? item.label}
          {item.matrix && <span className="ml-2 text-xs font-medium text-[var(--color-text-subtle)]">{item.matrix.columnLabel}</span>}
        </h3>
        {requiredKeys.has(key) ? <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} /> : <span className="text-xs text-[var(--color-text-subtle)]">Opcional</span>}
      </div>
      {draft.needsConfirmation && (
        <div className="flex flex-wrap items-center gap-2">
          <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
          {editable && <Button type="button" size="sm" variant="secondary" onClick={() => inspectionDraft.confirmRead(section.id, item.id)}>Confirmar contra la foto</Button>}
        </div>
      )}
      {scorable ? (
        <>
          <Field label="Resultado" required={requiredKeys.has(key)}>
            {editable ? (
              <Select value={draft.result || "__unset__"} onValueChange={(value) => inspectionDraft.update(section.id, item.id, { result: (value === "__unset__" ? "" : value) as ResultValue })}>
                {/* I-13: color visible también mientras se edita, no sólo en el badge de lectura. */}
                <SelectTrigger aria-label={`Resultado de ${item.label}`} className={resultSelectToneClass(draft.result)}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Sin responder</SelectItem>
                  {/* INS-01: las opciones salen de la escala del ítem, no del
                      mapa global. Ofrecer "No aplica" en un Anexo 13 dejaba
                      sacar del denominador un ítem que el papel obliga a
                      juzgar; y ahora la etiqueta es la del anexo ("Bueno"). */}
                  {inspectionResultOptionsFor(item.kind).map((option) => (
                    <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : draft.result ? <MetaBadge meta={{ label: `${inspectionResultLabel(item.kind, draft.result)}`, variant: resultBadgeVariant(draft.result) }} /> : <span>Sin respuesta</span>}
          </Field>
          <Field label="Comentario" hint={needsComment ? `Obligatorio para "${inspectionResultLabel(item.kind, draft.result)}"; mínimo 3 caracteres.` : "Opcional, salvo que el resultado requiera justificación."}>
            {editable ? <Textarea value={draft.comment} onChange={(event) => inspectionDraft.update(section.id, item.id, { comment: event.target.value })} rows={3} aria-label={`Comentario de ${item.label}`} /> : <p className="text-sm">{draft.comment || "Sin comentario"}</p>}
          </Field>
        </>
      ) : (
        <Field label="Respuesta" required={requiredKeys.has(key)}>
          {editable ? <NonScorableField item={item} value={draft.value} onChange={(next) => inspectionDraft.update(section.id, item.id, { value: next, result: next.trim() ? "recorded" : "" })} />
            // I-17 / P2-2: en lectura la respuesta se dice como la persona la entiende
            // (la fecha formateada, la opción por su etiqueta), no como se almacena.
            : <p className="whitespace-pre-wrap text-sm">{formatInspectionAnswerValue(item, draft.value, "Sin respuesta")}</p>}
        </Field>
      )}
      <Field label="Evidencia fotográfica" hint="La foto queda vinculada a este ítem.">
        <ItemEvidence model={model} itemKey={key} item={item} current={draft} />
      </Field>
    </article>
  )
}
