"use client"

import * as React from "react"
import { ChoiceCardGroup, type ChoiceCardOption, type ChoiceCardTone } from "@/components/ui/choice-card-group"
import {
  fieldKindIsScorable,
  inspectionResultOptionsFor,
  resultBadgeVariant,
  type InspectionResult,
} from "@/lib/prevention/inspections"
import { NonScorableField } from "./run-detail-controls"
import type { Draft, ItemInfo, ResultValue } from "./types"

/** Lo que el ítem le avisa al borrador al responder: el mismo `inspectionDraft.update`. */
export type UpdateItemDraft = (sectionId: string, itemId: string, patch: Partial<Draft>) => void

/**
 * El color de la opción elegida sale de la misma correspondencia que el badge de
 * lectura (`resultBadgeVariant`): lo conforme en verde, lo que incumple en rojo,
 * «Regular» en ámbar y lo demás (No aplica, No tiene) en neutro.
 */
const TONE_BY_BADGE: Record<ReturnType<typeof resultBadgeVariant>, ChoiceCardTone> = {
  success: "positive",
  danger: "negative",
  warning: "warning",
  outline: "neutral",
}

/** Las opciones de la escala del ítem (INS-01), con el tono de cada resultado. */
export function resultChoiceOptions(kind: ItemInfo["kind"]): ChoiceCardOption<InspectionResult>[] {
  return inspectionResultOptionsFor(kind).map((option) => ({
    value: option.result,
    title: option.label,
    tone: TONE_BY_BADGE[resultBadgeVariant(option.result)],
  }))
}

/**
 * El control con el que se responde un ítem: un grupo de botones de 44 px con
 * las opciones de su escala (en vez de un `Select` que esconde las opciones tras
 * un toque), o el campo que corresponda cuando el ítem no expresa conformidad
 * (B-08: un texto, una fecha, un número, una opción). El nombre accesible del
 * grupo es «Resultado de {ítem}»: los E2E y sus ayudas lo buscan por ese nombre.
 */
export function ItemAnswerControl({ item, sectionId, result, value, required, describedBy, onUpdate }: {
  item: ItemInfo
  sectionId: string
  result: string
  value: string
  required: boolean
  /** Id del texto de problema en línea, si lo hay (sólo lo anuncia el grupo de resultado). */
  describedBy?: string
  onUpdate: UpdateItemDraft
}) {
  const options = React.useMemo(() => resultChoiceOptions(item.kind), [item.kind])
  if (!fieldKindIsScorable(item.kind)) {
    // `NonScorableField` no recibe `aria-describedby`: su problema en línea queda como texto contiguo.
    return (
      <NonScorableField
        item={item}
        value={value}
        // El estado acompaña al contenido: sin valor el ítem vuelve a «sin responder» y el guardado lo borra (B-02).
        onChange={(next) => onUpdate(sectionId, item.id, { value: next, result: next.trim() ? "recorded" : "" })}
      />
    )
  }
  return (
    <ChoiceCardGroup
      variant="compact"
      label={`Resultado de ${item.label}`}
      options={options}
      value={result === "" ? null : (result as InspectionResult)}
      required={required}
      aria-describedby={describedBy}
      onChange={(next) => onUpdate(sectionId, item.id, { result: next as ResultValue })}
    />
  )
}
