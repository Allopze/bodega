"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  fieldKindIsScorable,
  inspectionResultLabel,
  inspectionResultOptionsFor,
  resultBadgeVariant,
} from "@/lib/prevention/inspections"
import { formatInspectionAnswerValue } from "@/lib/prevention/inspection-answer-format"
import { ItemEvidence } from "./item-evidence"
import { NonScorableField } from "./run-detail-controls"
import { draftKey, EMPTY_DRAFT } from "./run-view-helpers"
import type { ItemCardModel } from "./item-card"
import type { ResultValue, SectionInfo } from "./types"

export type ItemRowModel = ItemCardModel

/**
 * La fila de un ítem en la tabla de escritorio (`hidden md:block`; el teléfono
 * pinta `ItemCard`). El `id` `item-desktop-…` es al que salta `jumpToItem`.
 */
export function ItemRow({ model, section, item }: {
  model: ItemRowModel
  section: SectionInfo
  item: SectionInfo["items"][number]
}) {
  const { editable, drafts, requiredKeys, inspectionDraft } = model
  const key = draftKey(section.id, item.id)
  const draft = drafts[key] ?? EMPTY_DRAFT
  // 'Regular' exige justificarse por escrito igual que 'No aplica'
  // — mismo criterio que el motor SST (requiresObservation).
  // I-05: "No cumple" exige motivo igual que "No aplica"/"Regular" — es
  // el resultado que genera el hallazgo.
  const needsComment = draft.result === "not_applicable" || draft.result === "partial" || draft.result === "non_conforming"
  // B-08: un ítem que no expresa conformidad se responde con
  // su contenido. Antes se le ofrecía "Cumple / No cumple" y
  // el texto no tenía dónde guardarse.
  const scorable = fieldKindIsScorable(item.kind)
  return (
    <TableRow id={`item-desktop-${key}`} className="scroll-mt-20">
      <TableCell className="text-sm">
        {item.matrix ? (
          <span><span className="font-medium">{item.matrix.rowLabel}</span><span className="ml-2 text-xs text-[var(--color-text-subtle)]">{item.matrix.columnLabel}</span></span>
        ) : item.label}
        {requiredKeys.has(key) && <MetaBadge meta={{ label: "Obligatorio", variant: "outline" }} className="ml-2" />}
        {draft.needsConfirmation && (
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <MetaBadge meta={{ label: "Leído de la planilla", variant: "warning" }} />
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => inspectionDraft.confirmRead(section.id, item.id)}
              >
                Confirmar contra la foto
              </Button>
            )}
          </span>
        )}
      </TableCell>
      {scorable ? (
        <>
          <TableCell>
            {editable ? (
              <Select value={draft.result || "__unset__"} onValueChange={(v) => inspectionDraft.update(section.id, item.id, { result: (v === "__unset__" ? "" : v) as ResultValue })}>
                <SelectTrigger aria-label={`Resultado de ${item.label}`}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Sin responder</SelectItem>
                  {inspectionResultOptionsFor(item.kind).map((option) => (
                    <SelectItem key={option.result} value={option.result}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : draft.result ? (
              <MetaBadge meta={{ label: `${inspectionResultLabel(item.kind, draft.result)}`, variant: resultBadgeVariant(draft.result) }} />
            ) : "—"}
          </TableCell>
          <TableCell>
            {editable ? (
              <Input
                value={draft.comment}
                onChange={(event) => inspectionDraft.update(section.id, item.id, { comment: event.target.value })}
                // El motivo nombra el resultado como lo nombra el instrumento:
                // en un Anexo B/R/M pide "Motivo del Malo", no "del No cumple".
                placeholder={needsComment ? `Motivo del "${inspectionResultLabel(item.kind, draft.result)}" (mínimo 3 caracteres)` : "Opcional"}
                aria-label={`Comentario de ${item.label}`}
              />
            ) : (
              <span className="text-sm text-[var(--color-text-subtle)]">{draft.comment || "—"}</span>
            )}
          </TableCell>
        </>
      ) : (
        // El valor ES la respuesta, así que ocupa las dos
        // columnas de conformidad: no hay nada que juzgar aparte.
        <TableCell colSpan={2}>
          {editable ? (
            <NonScorableField
              item={item}
              value={draft.value}
              onChange={(next) => inspectionDraft.update(section.id, item.id, {
                value: next,
                // El estado acompaña al contenido: sin valor
                // el ítem vuelve a "sin responder" y el
                // guardado lo borra (B-02).
                result: next.trim() ? "recorded" : "",
              })}
            />
          ) : (
            // I-17 / P2-2: mismo formato que el resto de la pantalla.
            <span className="text-sm whitespace-pre-wrap">{formatInspectionAnswerValue(item, draft.value, "—")}</span>
          )}
        </TableCell>
      )}
      <TableCell>
        <ItemEvidence model={model} itemKey={key} item={item} current={draft} />
      </TableCell>
    </TableRow>
  )
}
