"use client"

import * as React from "react"
import { Tooltip } from "@/components/ui/tooltip"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
} from "@/lib/prevention/inspections"
import {
  formatComplianceBasisPoints,
  formatInspectionSubject,
} from "@/lib/prevention/inspection-answer-format"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { RunViewModel } from "./run-view-types"

export type RunFactsModel = Pick<
  RunViewModel,
  | "run" | "templateKind" | "worksiteName" | "assigneeName" | "executorName" | "summary" | "coords"
  | "pdtpActivityNumbers" | "pdtpReviewActivityNumbers"
  | "requiredItems" | "answeredRequired" | "answeredCount" | "items"
>

export type RunFactId =
  | "status" | "kind" | "origin" | "worksite" | "subject" | "assignee" | "scheduled" | "executed"
  | "officialResult" | "normalizedResult" | "location" | "pdtp"

export interface RunFact {
  id: RunFactId
  label: string
  value: string
  /** Sigla del rótulo que lleva un Tooltip con su significado (A6: las abreviaturas se explican). */
  hint?: { term: string; text: string }
}

/** Mientras se captura no hay cumplimiento que mostrar: se calcula al declarar ejecutada. */
function complianceIsKnown(status: string) {
  return status !== "planned" && status !== "in_progress"
}

/**
 * Los datos de contexto de la inspección, en el orden en que se muestran. El
 * cumplimiento sólo aparece después de declararla ejecutada: antes decía «100%»
 * con 1 de 24 ítems respondidos.
 */
export function buildRunFacts(model: RunFactsModel): RunFact[] {
  const { run, templateKind, worksiteName, assigneeName, executorName, summary, coords, pdtpActivityNumbers, pdtpReviewActivityNumbers } = model
  const facts: RunFact[] = [
    { id: "status", label: "Estado", value: inspectionTaskStatusLabel(run.status) },
    { id: "kind", label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { id: "origin", label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
    { id: "worksite", label: "Faena", value: worksiteName },
    { id: "subject", label: "Sujeto", value: formatInspectionSubject(run.subjectType, run.subjectLabel) },
    { id: "assignee", label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { id: "scheduled", label: "Programada para", value: run.scheduledFor ? formatDate(run.scheduledFor) : "Sin fecha" },
    { id: "executed", label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
  ]
  if (complianceIsKnown(run.status)) {
    facts.push(
      {
        id: "officialResult",
        label: "Resultado oficial",
        value: formatComplianceBasisPoints(run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints, "Sin fórmula en el documento"),
      },
      {
        id: "normalizedResult",
        label: "Resultado normalizado",
        value: formatComplianceBasisPoints(run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints, "Aún no calculable"),
      },
    )
  }
  facts.push(
    { id: "location", label: "Ubicación", value: coords ? `${coords.lat}, ${coords.lon} · dato de apoyo opcional` : "No capturada · opcional" },
    // Qué acredita en el programa anual, y en qué etapa. El estado del run dice
    // si ya ocurrió: `completed` cierra la primera, `reviewed` la segunda.
    {
      id: "pdtp",
      label: "Acredita en el PDTP",
      hint: { term: "PDTP", text: "Programa de trabajo preventivo" },
      value: [
        pdtpActivityNumbers.length > 0 ? `N° ${pdtpActivityNumbers.join(", ")} al ejecutar` : null,
        pdtpReviewActivityNumbers.length > 0 ? `N° ${pdtpReviewActivityNumbers.join(", ")} al revisar` : null,
      ].filter(Boolean).join(" · ") || "No acredita ninguna actividad",
    },
  )
  return facts
}

/** El rótulo de un dato; si lleva una sigla, ésta explica su significado con un Tooltip enfocable. */
export function FactLabel({ fact }: { fact: Pick<RunFact, "label" | "hint"> }) {
  const { label, hint } = fact
  if (!hint) return <>{label}</>
  const at = label.indexOf(hint.term)
  if (at === -1) return <>{label}</>
  return (
    <>
      {label.slice(0, at)}
      <Tooltip content={hint.text}>
        <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">{hint.term}</span>
      </Tooltip>
      {label.slice(at + hint.term.length)}
    </>
  )
}
