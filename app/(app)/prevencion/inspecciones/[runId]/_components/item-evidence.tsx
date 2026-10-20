"use client"

import * as React from "react"
import { AnswerEvidence } from "./inspection-evidence"
import type { RunViewModel } from "./run-view-types"
import type { Draft, ItemInfo } from "./types"

export type ItemEvidenceModel = Pick<RunViewModel, "editable" | "channel" | "heldByKey">

/** Evidencia fotográfica de un ítem: la misma en la tarjeta y en la fila. */
export function ItemEvidence({ model, itemKey, item, current }: {
  model: ItemEvidenceModel
  /** `sectionId::itemId`. */
  itemKey: string
  item: ItemInfo
  current: Draft
}) {
  const { editable, channel, heldByKey } = model
  const heldRow = heldByKey.get(itemKey)
  return (
    <AnswerEvidence
      answerId={channel.answerIds[itemKey] ?? null}
      evidence={channel.evidenceByKey.get(itemKey)}
      editable={editable}
      readyToPersist={current.result !== ""}
      ensureAnswerId={() => channel.ensureAnswerId(itemKey)}
      itemLabel={item.label}
      onEvidenceChange={(count) => channel.onEvidenceChange(itemKey, count)}
      blockedReason={heldRow?.reason === "invalid" ? "Completa el motivo antes de adjuntar fotos" : undefined}
    />
  )
}
