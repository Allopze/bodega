"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Tooltip } from "@/components/ui/tooltip"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  runStatusBadgeVariant,
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

/**
 * La ficha de contexto: en el teléfono una tarjeta con «Ver contexto completo»
 * plegado; desde `md`, una rejilla con todos los datos. Son dos nodos hermanos
 * (uno oculto por CSS), así que el componente devuelve un fragmento.
 */
export function RunFacts({ model }: { model: RunFactsModel }) {
  const { run, worksiteName, assigneeName, requiredItems, answeredRequired, answeredCount, items } = model
  const facts = buildRunFacts(model)
  return (
    <>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Trabajo actual</p>
            <p className="mt-1 text-base font-semibold">{worksiteName}{run.subjectLabel ? ` · ${run.subjectLabel}` : ""}</p>
          </div>
          <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div><span className="block text-[var(--color-text-subtle)]">Responsable</span><span className="mt-0.5 block font-medium">{assigneeName ?? "Sin asignar"}</span></div>
          {/* I-02: sin obligatorios efectivos (instrumento de un solo ítem de
              texto libre) "0 de N obligatorios" mentía igual que antes, sólo
              que al revés — se muestra el avance total en su lugar. */}
          <div>
            <span className="block text-[var(--color-text-subtle)]">{requiredItems.length > 0 ? "Avance obligatorio" : "Avance"}</span>
            <span className="mt-0.5 block font-medium">{requiredItems.length > 0 ? `${answeredRequired} de ${requiredItems.length}` : `${answeredCount} de ${items.length}`}</span>
          </div>
        </div>
        <details className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
          <summary className="cursor-pointer font-medium">Ver contexto completo</summary>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {facts.slice(1).map((fact) => <div key={fact.id}><dt className="text-xs text-[var(--color-text-subtle)]"><FactLabel fact={fact} /></dt><dd className="mt-0.5 text-xs font-medium">{fact.value}</dd></div>)}
          </dl>
        </details>
      </section>

      <div className="hidden grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.id} className="bg-[var(--color-surface)] px-4 py-3">
            <span className="text-eyebrow"><FactLabel fact={fact} /></span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>
    </>
  )
}
